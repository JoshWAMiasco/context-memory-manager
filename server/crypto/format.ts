import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { open, type FileHandle } from "node:fs/promises";
import { Readable, Transform, type TransformCallback } from "node:stream";
import { ApiRouteError } from "@/server/http/api-error";

/*
 * The encrypted file format `CCM1` (AES-256-GCM-STREAM-v1):
 *
 *   header (40 bytes, the AAD of every chunk)
 *     0 "CCM1" · 4 version 1 · 5 flags 0 · 6 chunkLog2 16 · 7 reserved 0 · 8 keyId (16) · 24 fileSalt (16)
 *   body: chunks of up to 64 KiB of ciphertext, each followed by its 16-byte GCM tag
 *
 * Each file has its own subkey, HKDF-SHA256(DEK, fileSalt, "ccm/file/v1"). The nonce of chunk i is
 * 7 zero bytes, i as uint32 big-endian, then 1 for the last chunk and 0 otherwise, so truncation,
 * reordering and bit flips all fail authentication. An empty file is one empty last chunk.
 */

export const CRYPTO_MAGIC = Buffer.from("CCM1", "ascii");
export const CRYPTO_FORMAT_VERSION = 1;
export const CRYPTO_ALGORITHM = "AES-256-GCM-STREAM-v1";
export const HEADER_BYTES = 40;
export const CHUNK_LOG2 = 16;
export const CHUNK_BYTES = 2 ** CHUNK_LOG2;
export const TAG_BYTES = 16;
export const SEALED_CHUNK_BYTES = CHUNK_BYTES + TAG_BYTES;
export const KEY_BYTES = 32;
export const KEY_ID_BYTES = 16;
export const SALT_BYTES = 16;

const FILE_KEY_INFO = "ccm/file/v1";
const NONCE_BYTES = 12;

/** A chunk failed authentication: the file is damaged, was changed outside CMM, or needs another key. */
export class CryptoAuthError extends ApiRouteError {
  override name = "CryptoAuthError";

  constructor(message = "This file is damaged or was modified outside CMM.") {
    super(422, "CRYPTO_AUTH_FAILED", message);
  }
}

/** The bytes are not a `CCM1` file this version can read. */
export class CryptoFormatError extends ApiRouteError {
  override name = "CryptoFormatError";

  constructor(message = "This file is not in CMM's encrypted format.") {
    super(422, "CRYPTO_AUTH_FAILED", message);
  }
}

export interface CryptoHeader {
  keyId: Buffer;
  fileSalt: Buffer;
  /** The 40 header bytes, used as AAD. */
  bytes: Buffer;
}

/** Finds the DEK for a file's key id; throws (or returns undefined) when that key isn't available. */
export type KeyResolver = (keyId: Buffer) => Buffer | undefined;

function toResolver(keys: Buffer | KeyResolver): KeyResolver {
  return typeof keys === "function" ? keys : () => keys;
}

export function buildHeader(keyId: Buffer, fileSalt: Buffer): Buffer {
  if (keyId.length !== KEY_ID_BYTES || fileSalt.length !== SALT_BYTES) {
    throw new CryptoFormatError("The key id and salt must be 16 bytes each.");
  }
  const header = Buffer.alloc(HEADER_BYTES);
  CRYPTO_MAGIC.copy(header, 0);
  header[4] = CRYPTO_FORMAT_VERSION;
  header[6] = CHUNK_LOG2;
  keyId.copy(header, 8);
  fileSalt.copy(header, 24);
  return header;
}

export function parseHeader(bytes: Buffer): CryptoHeader {
  if (bytes.length < HEADER_BYTES || !bytes.subarray(0, 4).equals(CRYPTO_MAGIC)) throw new CryptoFormatError();
  if (bytes[4] !== CRYPTO_FORMAT_VERSION || bytes[6] !== CHUNK_LOG2) {
    throw new CryptoFormatError("This file was encrypted by a newer CMM.");
  }
  const headerBytes = Buffer.from(bytes.subarray(0, HEADER_BYTES));
  return { keyId: headerBytes.subarray(8, 24), fileSalt: headerBytes.subarray(24, 40), bytes: headerBytes };
}

function deriveFileKey(dek: Buffer, fileSalt: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", dek, fileSalt, FILE_KEY_INFO, KEY_BYTES));
}

function buildNonce(chunkIndex: number, isLast: boolean): Buffer {
  const nonce = Buffer.alloc(NONCE_BYTES);
  nonce.writeUInt32BE(chunkIndex, 7);
  nonce[11] = isLast ? 1 : 0;
  return nonce;
}

function sealChunk(fileKey: Buffer, header: Buffer, chunkIndex: number, isLast: boolean, plaintext: Buffer): Buffer {
  const cipher = createCipheriv("aes-256-gcm", fileKey, buildNonce(chunkIndex, isLast), { authTagLength: TAG_BYTES });
  cipher.setAAD(header);
  return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}

function openChunk(fileKey: Buffer, header: Buffer, chunkIndex: number, isLast: boolean, sealed: Buffer): Buffer {
  if (sealed.length < TAG_BYTES || sealed.length > SEALED_CHUNK_BYTES) throw new CryptoAuthError();
  const decipher = createDecipheriv("aes-256-gcm", fileKey, buildNonce(chunkIndex, isLast), {
    authTagLength: TAG_BYTES,
  });
  decipher.setAAD(header);
  decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
  try {
    return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - TAG_BYTES)), decipher.final()]);
  } catch {
    throw new CryptoAuthError();
  }
}

function resolveFileKey(resolveKey: KeyResolver, header: CryptoHeader): Buffer {
  const dek = resolveKey(header.keyId);
  if (!dek) throw new CryptoAuthError("This file was encrypted with a different key.");
  return deriveFileKey(dek, header.fileSalt);
}

/**
 * Encrypts a stream into `CCM1`: the header first, then 64 KiB chunks. The last chunk is held back
 * until the input ends, so it can be marked as last.
 *
 * @example
 * await pipeline(createReadStream(plainPath), encryptStream(dek, keyId), createWriteStream(targetPath));
 */
export function encryptStream(dek: Buffer, keyId: Buffer, fileSalt: Buffer = randomBytes(SALT_BYTES)): Transform {
  const header = buildHeader(keyId, fileSalt);
  const fileKey = deriveFileKey(dek, fileSalt);
  let pending: Buffer = Buffer.alloc(0);
  let chunkIndex = 0;
  let hasPushedHeader = false;
  const pushHeaderOnce = (transform: Transform) => {
    if (hasPushedHeader) return;
    hasPushedHeader = true;
    transform.push(header);
  };
  return new Transform({
    transform(chunk: Buffer, _encoding, callback: TransformCallback) {
      pushHeaderOnce(this);
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      let offset = 0;
      while (pending.length - offset > CHUNK_BYTES) {
        this.push(sealChunk(fileKey, header, chunkIndex, false, pending.subarray(offset, offset + CHUNK_BYTES)));
        chunkIndex += 1;
        offset += CHUNK_BYTES;
      }
      pending = offset === 0 ? pending : Buffer.from(pending.subarray(offset));
      callback();
    },
    flush(callback: TransformCallback) {
      pushHeaderOnce(this);
      this.push(sealChunk(fileKey, header, chunkIndex, true, pending));
      fileKey.fill(0);
      callback();
    },
    destroy(destroyError, callback) {
      fileKey.fill(0);
      callback(destroyError);
    },
  });
}

/**
 * Decrypts a `CCM1` stream. Each chunk is authenticated before any of its plaintext is passed on;
 * the last full chunk is held back until the input ends, so a file cut at a chunk boundary fails.
 * `keys` is the folder's DEK, or a resolver by key id (both keys while re-keying).
 *
 * @example
 * await pipeline(createReadStream(encryptedPath), decryptStream(dek), response);
 */
export function decryptStream(keys: Buffer | KeyResolver): Transform {
  const resolveKey = toResolver(keys);
  let header: CryptoHeader | undefined;
  let fileKey: Buffer | undefined;
  let pending: Buffer = Buffer.alloc(0);
  let chunkIndex = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback: TransformCallback) {
      try {
        pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
        if (!header) {
          if (pending.length < HEADER_BYTES) {
            callback();
            return;
          }
          header = parseHeader(pending);
          fileKey = resolveFileKey(resolveKey, header);
          pending = Buffer.from(pending.subarray(HEADER_BYTES));
        }
        let offset = 0;
        while (pending.length - offset > SEALED_CHUNK_BYTES) {
          const sealed = pending.subarray(offset, offset + SEALED_CHUNK_BYTES);
          this.push(openChunk(fileKey as Buffer, header.bytes, chunkIndex, false, sealed));
          chunkIndex += 1;
          offset += SEALED_CHUNK_BYTES;
        }
        pending = offset === 0 ? pending : Buffer.from(pending.subarray(offset));
        callback();
      } catch (decryptError) {
        callback(decryptError as Error);
      }
    },
    flush(callback: TransformCallback) {
      try {
        if (!header || !fileKey) throw new CryptoFormatError("The encrypted file is truncated.");
        this.push(openChunk(fileKey, header.bytes, chunkIndex, true, pending));
        fileKey.fill(0);
        callback();
      } catch (decryptError) {
        callback(decryptError as Error);
      }
    },
    destroy(destroyError, callback) {
      fileKey?.fill(0);
      callback(destroyError);
    },
  });
}

/** Encrypts a whole buffer (small files, tests). */
export function encryptBuffer(
  dek: Buffer,
  keyId: Buffer,
  plaintext: Buffer,
  fileSalt: Buffer = randomBytes(SALT_BYTES),
): Buffer {
  const header = buildHeader(keyId, fileSalt);
  const fileKey = deriveFileKey(dek, fileSalt);
  const parts = [header];
  const chunkCount = Math.max(1, Math.ceil(plaintext.length / CHUNK_BYTES));
  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const chunk = plaintext.subarray(chunkIndex * CHUNK_BYTES, (chunkIndex + 1) * CHUNK_BYTES);
    parts.push(sealChunk(fileKey, header, chunkIndex, chunkIndex === chunkCount - 1, chunk));
  }
  fileKey.fill(0);
  return Buffer.concat(parts);
}

/** Decrypts a whole `CCM1` buffer. */
export function decryptBuffer(keys: Buffer | KeyResolver, encrypted: Buffer): Buffer {
  const header = parseHeader(encrypted);
  const chunkCount = countChunks(encrypted.length);
  const fileKey = resolveFileKey(toResolver(keys), header);
  const parts: Buffer[] = [];
  try {
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      const start = HEADER_BYTES + chunkIndex * SEALED_CHUNK_BYTES;
      const sealed = encrypted.subarray(start, Math.min(start + SEALED_CHUNK_BYTES, encrypted.length));
      parts.push(openChunk(fileKey, header.bytes, chunkIndex, chunkIndex === chunkCount - 1, sealed));
    }
  } finally {
    fileKey.fill(0);
  }
  return Buffer.concat(parts);
}

/** How many chunks a `CCM1` file of `fileSize` bytes holds; throws for sizes no valid file has. */
export function countChunks(fileSize: number): number {
  const bodyBytes = fileSize - HEADER_BYTES;
  if (bodyBytes < TAG_BYTES) throw new CryptoFormatError("The encrypted file is truncated.");
  const chunkCount = Math.max(1, Math.ceil(bodyBytes / SEALED_CHUNK_BYTES));
  const lastSealedBytes = bodyBytes - (chunkCount - 1) * SEALED_CHUNK_BYTES;
  if (lastSealedBytes < TAG_BYTES || (chunkCount > 1 && lastSealedBytes === TAG_BYTES)) {
    throw new CryptoFormatError("The encrypted file is truncated.");
  }
  return chunkCount;
}

/**
 * The plaintext size of a `CCM1` file: `fileSize − 40 − 16·N`.
 *
 * @example
 * plaintextSize(56); // 0, an empty file
 */
export function plaintextSize(fileSize: number): number {
  return fileSize - HEADER_BYTES - TAG_BYTES * countChunks(fileSize);
}

/** The `CCM1` file size for `plainBytes` of plaintext. */
export function encryptedSize(plainBytes: number): number {
  return HEADER_BYTES + plainBytes + TAG_BYTES * Math.max(1, Math.ceil(plainBytes / CHUNK_BYTES));
}

async function readExactly(fileHandle: FileHandle, length: number, position: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    const { bytesRead } = await fileHandle.read(buffer, filled, length - filled, position + filled);
    if (bytesRead === 0) break;
    filled += bytesRead;
  }
  return filled === length ? buffer : buffer.subarray(0, filled);
}

/** The header of an open file; throws `CryptoFormatError` when it isn't `CCM1`. */
export async function readHeader(fileHandle: FileHandle): Promise<CryptoHeader> {
  return parseHeader(await readExactly(fileHandle, HEADER_BYTES, 0));
}

/** The header of a file, or undefined when it isn't a `CCM1` file (or can't be read). */
export async function readFileHeader(filePath: string): Promise<CryptoHeader | undefined> {
  let fileHandle: FileHandle | undefined;
  try {
    fileHandle = await open(filePath, "r");
    return await readHeader(fileHandle);
  } catch {
    return undefined;
  } finally {
    await fileHandle?.close().catch(() => undefined);
  }
}

/** Whether a file starts with the `CCM1` magic and is at least as long as the header. */
export async function isEncryptedFile(filePath: string): Promise<boolean> {
  return (await readFileHeader(filePath)) !== undefined;
}

/**
 * Decrypts the plaintext bytes `start`..`end` (inclusive) of a `CCM1` file, reading only the
 * chunks they fall in (range requests for video).
 *
 * @example
 * const stream = decryptRange(filePath, dek, 0, 1023);
 */
export function decryptRange(filePath: string, keys: Buffer | KeyResolver, start: number, end: number): Readable {
  const resolveKey = toResolver(keys);
  async function* readPlaintext(): AsyncGenerator<Buffer> {
    const fileHandle = await open(filePath, "r");
    let fileKey: Buffer | undefined;
    try {
      const fileSize = (await fileHandle.stat()).size;
      const header = await readHeader(fileHandle);
      const chunkCount = countChunks(fileSize);
      fileKey = resolveFileKey(resolveKey, header);
      const lastByte = Math.min(end, plaintextSize(fileSize) - 1);
      for (
        let chunkIndex = Math.floor(start / CHUNK_BYTES);
        chunkIndex <= Math.floor(lastByte / CHUNK_BYTES);
        chunkIndex += 1
      ) {
        const position = HEADER_BYTES + chunkIndex * SEALED_CHUNK_BYTES;
        const sealed = await readExactly(fileHandle, Math.min(SEALED_CHUNK_BYTES, fileSize - position), position);
        const plaintext = openChunk(fileKey, header.bytes, chunkIndex, chunkIndex === chunkCount - 1, sealed);
        const chunkStart = chunkIndex * CHUNK_BYTES;
        yield plaintext.subarray(Math.max(0, start - chunkStart), lastByte - chunkStart + 1);
      }
    } finally {
      fileKey?.fill(0);
      await fileHandle.close().catch(() => undefined);
    }
  }
  return Readable.from(readPlaintext(), { objectMode: false });
}

/**
 * Authenticates a `CCM1` file before it replaces another: every chunk when it is at most
 * `fullCheckBytes`, otherwise the first and the last chunk. Throws `CryptoAuthError` or
 * `CryptoFormatError`.
 */
export async function verifyEncryptedFile(
  filePath: string,
  keys: Buffer | KeyResolver,
  { fullCheckBytes = 50 * 1024 * 1024 }: { fullCheckBytes?: number } = {},
): Promise<void> {
  const fileHandle = await open(filePath, "r");
  let fileKey: Buffer | undefined;
  try {
    const fileSize = (await fileHandle.stat()).size;
    const header = await readHeader(fileHandle);
    const chunkCount = countChunks(fileSize);
    fileKey = resolveFileKey(toResolver(keys), header);
    const isFullCheck = fileSize <= fullCheckBytes;
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      if (!isFullCheck && chunkIndex !== 0 && chunkIndex !== chunkCount - 1) continue;
      const position = HEADER_BYTES + chunkIndex * SEALED_CHUNK_BYTES;
      const sealed = await readExactly(fileHandle, Math.min(SEALED_CHUNK_BYTES, fileSize - position), position);
      openChunk(fileKey, header.bytes, chunkIndex, chunkIndex === chunkCount - 1, sealed).fill(0);
    }
  } finally {
    fileKey?.fill(0);
    await fileHandle.close();
  }
}

/**
 * How much plaintext a partly written `CCM1` file of `partBytes` holds when the whole file will
 * have `totalSize` plaintext bytes: whole chunks only, plus the last chunk once it is complete.
 * `partBytes` in the result is where a resumed write must continue (a torn chunk is cut off).
 *
 * @example
 * readPartProgress(40 + 65552 + 100, 200_000); // { plainBytes: 65536, partBytes: 65592 }
 */
export function readPartProgress(partBytes: number, totalSize: number): { plainBytes: number; partBytes: number } {
  if (partBytes < HEADER_BYTES) return { plainBytes: 0, partBytes: 0 };
  const bodyBytes = partBytes - HEADER_BYTES;
  const wholeChunks = Math.floor(bodyBytes / SEALED_CHUNK_BYTES);
  const lastChunkBytes = totalSize - wholeChunks * CHUNK_BYTES;
  if (
    lastChunkBytes >= 0 &&
    lastChunkBytes < CHUNK_BYTES &&
    bodyBytes % SEALED_CHUNK_BYTES === lastChunkBytes + TAG_BYTES
  ) {
    return { plainBytes: totalSize, partBytes };
  }
  const plainBytes = Math.min(wholeChunks * CHUNK_BYTES, totalSize);
  return { plainBytes, partBytes: HEADER_BYTES + wholeChunks * SEALED_CHUNK_BYTES };
}

/**
 * Encrypts the next part of a file whose header is already written (uploads): plaintext from
 * `plainOffset` (a multiple of 64 KiB) on. Full chunks are sealed as they fill; the chunk that
 * ends the file at `totalSize` is sealed as last. A partial chunk left when the input stops early
 * is dropped, so the part always ends on a chunk boundary.
 *
 * @example
 * await pipeline(requestBody, encryptAppender(dek, header, 0, size), createWriteStream(partPath, { flags: "a" }));
 */
export function encryptAppender(dek: Buffer, header: CryptoHeader, plainOffset: number, totalSize: number): Transform {
  if (plainOffset % CHUNK_BYTES !== 0) throw new CryptoFormatError("An append must start on a chunk boundary.");
  const fileKey = deriveFileKey(dek, header.fileSalt);
  let pending: Buffer = Buffer.alloc(0);
  let chunkIndex = plainOffset / CHUNK_BYTES;
  let sealedEnd = plainOffset;
  let hasSealedLast = false;
  const sealReady = (transform: Transform, isEnd: boolean) => {
    let offset = 0;
    while (!hasSealedLast) {
      const chunkLength = Math.min(CHUNK_BYTES, totalSize - sealedEnd);
      const available = pending.length - offset;
      const isLast = sealedEnd + chunkLength === totalSize;
      if (available < chunkLength || (chunkLength === 0 && !(isLast && isEnd))) break;
      transform.push(
        sealChunk(fileKey, header.bytes, chunkIndex, isLast, pending.subarray(offset, offset + chunkLength)),
      );
      offset += chunkLength;
      sealedEnd += chunkLength;
      chunkIndex += 1;
      hasSealedLast = isLast;
    }
    pending = offset === 0 ? pending : Buffer.from(pending.subarray(offset));
  };
  return new Transform({
    transform(chunk: Buffer, _encoding, callback: TransformCallback) {
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      if (sealedEnd + pending.length > totalSize) {
        callback(new CryptoFormatError("The upload is larger than announced."));
        return;
      }
      sealReady(this, false);
      callback();
    },
    flush(callback: TransformCallback) {
      sealReady(this, true);
      fileKey.fill(0);
      callback();
    },
    destroy(destroyError, callback) {
      fileKey.fill(0);
      callback(destroyError);
    },
  });
}
