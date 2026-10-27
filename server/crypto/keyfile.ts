import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { hashRaw } from "@node-rs/argon2";
import { z } from "zod";
import {
  findKeyFilePassphraseProblem,
  KEY_FILE_EXTENSION,
  readKeyFileProtection,
  type KeyFileProtection,
} from "@/lib/key-file";
import { ARGON2_PARAMETERS } from "@/server/auth/password";
import { ApiRouteError } from "@/server/http/api-error";
import { KEY_BYTES, KEY_ID_BYTES } from "@/server/crypto/format";

export { KEY_FILE_EXTENSION };

/** Key files are under 2 KB; anything over 4 KB is refused before parsing. */
export const MAX_KEY_FILE_BYTES = 4096;

const KEY_CHECK_LABEL = Buffer.from("ccm/keycheck/v1", "utf8");
/** The AAD prefix of a wrapped key, so a wrapped blob can't be moved to another key file. */
const KEY_WRAP_LABEL = Buffer.from("cmm/keywrap/v2", "utf8");
const WRAP_SALT_BYTES = 16;
const WRAP_NONCE_BYTES = 12;
const WRAP_TAG_BYTES = 16;

export interface FolderKey {
  dek: Buffer;
  keyId: Buffer;
}

/** What a key file holds once parsed. `dek` is secret: never log or return it. */
export interface ParsedKeyFile extends FolderKey {
  folderId: string;
  folderName: string;
  createdAt: string;
  /** True when the file was wrapped with a passphrase (v2). */
  isProtected: boolean;
}

/** An uploaded key file and, for a passphrase-protected one, the passphrase that opens it. */
export interface KeyFileInput {
  bytes: Buffer;
  passphrase?: string;
}

const base64Schema = (byteLength: number) =>
  z
    .string()
    .regex(/^[A-Za-z0-9+/]+={0,2}$/)
    .refine((value) => Buffer.from(value, "base64").length === byteLength, `Must be ${byteLength} bytes.`);

const keyFileHeaderShape = {
  type: z.literal("ccm-key"),
  folderId: z.uuid(),
  keyId: base64Schema(KEY_ID_BYTES),
  folderName: z.string().max(255),
  createdAt: z.string().max(64),
};

/** v1: the key itself, with an integrity checksum. */
const rawKeyFileSchema = z.object({
  v: z.literal(1),
  ...keyFileHeaderShape,
  key: base64Schema(KEY_BYTES),
  checksum: z.string().regex(/^[\da-f]{16}$/),
});

/**
 * v2: the key sealed with AES-256-GCM under a key derived from a passphrase with Argon2id. The
 * parameters are stored so a file written with stronger settings later still opens.
 */
const protectedKeyFileSchema = z.object({
  v: z.literal(2),
  ...keyFileHeaderShape,
  kdf: z.object({
    algorithm: z.literal("argon2id"),
    memoryCost: z.number().int().min(8).max(4_194_304),
    timeCost: z.number().int().min(1).max(64),
    parallelism: z.number().int().min(1).max(64),
    salt: base64Schema(WRAP_SALT_BYTES),
  }),
  wrapped: z.object({
    nonce: base64Schema(WRAP_NONCE_BYTES),
    key: base64Schema(KEY_BYTES),
    tag: base64Schema(WRAP_TAG_BYTES),
  }),
});

/** A new random folder key: a 32-byte DEK and a 16-byte key id. */
export function generateFolderKey(): FolderKey {
  return { dek: randomBytes(KEY_BYTES), keyId: randomBytes(KEY_ID_BYTES) };
}

function computeChecksum(dek: Buffer, keyId: Buffer): string {
  return createHash("sha256").update(dek).update(keyId).digest().subarray(0, 8).toString("hex");
}

/**
 * The `keyCheck` stored in `.cmm/crypto.json`: base64 HMAC-SHA256(DEK, "ccm/keycheck/v1" || keyId).
 * It proves an uploaded key is the folder's key without decrypting a file, and reveals nothing
 * about the key.
 */
export function computeKeyCheck(dek: Buffer, keyId: Buffer): string {
  return createHmac("sha256", dek).update(KEY_CHECK_LABEL).update(keyId).digest("base64");
}

function toKeyFileBytes(document: Record<string, unknown>): Buffer {
  return Buffer.from(`${JSON.stringify(document, null, 2)}\n`, "utf8");
}

function keyFileHeader(keyFile: Omit<ParsedKeyFile, "dek" | "isProtected">): Record<string, unknown> {
  return {
    type: "ccm-key",
    folderId: keyFile.folderId,
    keyId: keyFile.keyId.toString("base64"),
    folderName: keyFile.folderName,
    createdAt: keyFile.createdAt,
  };
}

/**
 * The raw (v1) `.cmmkey` file for a folder key, as JSON bytes: whoever holds it holds the key.
 *
 * @example
 * const keyFileBytes = buildKeyFile({ folderId, folderName: "persona", createdAt, ...generateFolderKey() });
 */
export function buildKeyFile(keyFile: Omit<ParsedKeyFile, "isProtected">): Buffer {
  return toKeyFileBytes({
    v: 1,
    ...keyFileHeader(keyFile),
    key: keyFile.dek.toString("base64"),
    checksum: computeChecksum(keyFile.dek, keyFile.keyId),
  });
}

function wrapAad(folderId: string, keyId: Buffer): Buffer {
  return Buffer.concat([KEY_WRAP_LABEL, Buffer.from(folderId, "utf8"), keyId]);
}

async function deriveWrappingKey(
  passphrase: string,
  salt: Buffer,
  parameters: { memoryCost: number; timeCost: number; parallelism: number },
): Promise<Buffer> {
  return hashRaw(passphrase, {
    algorithm: ARGON2_PARAMETERS.algorithm,
    memoryCost: parameters.memoryCost,
    timeCost: parameters.timeCost,
    parallelism: parameters.parallelism,
    salt,
    outputLen: KEY_BYTES,
  });
}

/**
 * The passphrase-protected (v2) `.cmmkey` file for a folder key: the DEK sealed with AES-256-GCM
 * under Argon2id(passphrase, salt), with the folder id and key id as associated data. The file
 * is useless without the passphrase; the raw file from `buildKeyFile` stays the recovery copy.
 *
 * @example
 * const protectedBytes = await buildProtectedKeyFile({ folderId, folderName, createdAt, dek, keyId }, passphrase);
 */
export async function buildProtectedKeyFile(
  keyFile: Omit<ParsedKeyFile, "isProtected">,
  passphrase: string,
): Promise<Buffer> {
  const passphraseProblem = findKeyFilePassphraseProblem(passphrase);
  if (passphraseProblem) throw new ApiRouteError(400, "VALIDATION_FAILED", passphraseProblem);
  const salt = randomBytes(WRAP_SALT_BYTES);
  const nonce = randomBytes(WRAP_NONCE_BYTES);
  const parameters = {
    memoryCost: ARGON2_PARAMETERS.memoryCost,
    timeCost: ARGON2_PARAMETERS.timeCost,
    parallelism: ARGON2_PARAMETERS.parallelism,
  };
  const wrappingKey = await deriveWrappingKey(passphrase, salt, parameters);
  try {
    const cipher = createCipheriv("aes-256-gcm", wrappingKey, nonce, { authTagLength: WRAP_TAG_BYTES });
    cipher.setAAD(wrapAad(keyFile.folderId, keyFile.keyId));
    const wrappedKey = Buffer.concat([cipher.update(keyFile.dek), cipher.final()]);
    return toKeyFileBytes({
      v: 2,
      ...keyFileHeader(keyFile),
      kdf: { algorithm: "argon2id", ...parameters, salt: salt.toString("base64") },
      wrapped: {
        nonce: nonce.toString("base64"),
        key: wrappedKey.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
      },
    });
  } finally {
    wrappingKey.fill(0);
  }
}

function invalidKeyFile(message: string): ApiRouteError {
  return new ApiRouteError(400, "WRONG_KEY_FILE", message);
}

/** 400 `KEY_FILE_PASSPHRASE_REQUIRED`: the key file is protected and no passphrase was given. */
export function passphraseRequired(): ApiRouteError {
  return new ApiRouteError(
    400,
    "KEY_FILE_PASSPHRASE_REQUIRED",
    "This key file is protected by a passphrase. Enter it to use the key file.",
  );
}

/** 400 `WRONG_PASSPHRASE`: the passphrase doesn't open the key file (counted like a wrong key file). */
export function wrongPassphrase(): ApiRouteError {
  return new ApiRouteError(400, "WRONG_PASSPHRASE", "That passphrase doesn't open this key file.");
}

function readDocument(bytes: Buffer): { document: unknown; protection: KeyFileProtection } {
  if (bytes.length > MAX_KEY_FILE_BYTES) throw invalidKeyFile("That file is too large to be a CMM key file.");
  const text = bytes.toString("utf8");
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    throw invalidKeyFile("That file is not a CMM key file.");
  }
  return { document, protection: readKeyFileProtection(text) };
}

/**
 * Whether an uploaded file is a raw or a passphrase-protected key file, without parsing the rest.
 *
 * @example
 * if (readKeyFileKind(bytes) === "passphrase" && !passphrase) throw passphraseRequired();
 */
export function readKeyFileKind(bytes: Buffer): KeyFileProtection {
  if (bytes.length > MAX_KEY_FILE_BYTES) return "unknown";
  return readKeyFileProtection(bytes.toString("utf8"));
}

function parseRawKeyFile(document: unknown): ParsedKeyFile {
  const parsed = rawKeyFileSchema.safeParse(document);
  if (!parsed.success) throw invalidKeyFile("That file is not a CMM key file.");
  const dek = Buffer.from(parsed.data.key, "base64");
  const keyId = Buffer.from(parsed.data.keyId, "base64");
  const expectedChecksum = Buffer.from(computeChecksum(dek, keyId), "hex");
  if (!timingSafeEqual(expectedChecksum, Buffer.from(parsed.data.checksum, "hex"))) {
    dek.fill(0);
    throw invalidKeyFile("The key file is damaged: its checksum doesn't match.");
  }
  return {
    dek,
    keyId,
    folderId: parsed.data.folderId,
    folderName: parsed.data.folderName,
    createdAt: parsed.data.createdAt,
    isProtected: false,
  };
}

async function parseProtectedKeyFile(document: unknown, passphrase: string | undefined): Promise<ParsedKeyFile> {
  const parsed = protectedKeyFileSchema.safeParse(document);
  if (!parsed.success) throw invalidKeyFile("That file is not a CMM key file.");
  if (!passphrase) throw passphraseRequired();
  const { kdf, wrapped } = parsed.data;
  const keyId = Buffer.from(parsed.data.keyId, "base64");
  const wrappingKey = await deriveWrappingKey(passphrase, Buffer.from(kdf.salt, "base64"), kdf);
  try {
    const decipher = createDecipheriv("aes-256-gcm", wrappingKey, Buffer.from(wrapped.nonce, "base64"), {
      authTagLength: WRAP_TAG_BYTES,
    });
    decipher.setAAD(wrapAad(parsed.data.folderId, keyId));
    decipher.setAuthTag(Buffer.from(wrapped.tag, "base64"));
    let dek: Buffer;
    try {
      dek = Buffer.concat([decipher.update(Buffer.from(wrapped.key, "base64")), decipher.final()]);
    } catch {
      throw wrongPassphrase();
    }
    return {
      dek,
      keyId,
      folderId: parsed.data.folderId,
      folderName: parsed.data.folderName,
      createdAt: parsed.data.createdAt,
      isProtected: true,
    };
  } finally {
    wrappingKey.fill(0);
  }
}

/**
 * Reads an uploaded `.cmmkey` file: at most 4 KB, valid JSON in the v1 (raw) or v2 (passphrase)
 * shape. A v1 file's checksum must match the key; a v2 file needs its passphrase, which must open
 * it. Throws 400 `WRONG_KEY_FILE`, `KEY_FILE_PASSPHRASE_REQUIRED` or `WRONG_PASSPHRASE`.
 *
 * @example
 * const keyFile = await parseKeyFile({ bytes: await uploadedFile.arrayBuffer().then(Buffer.from), passphrase });
 */
export async function parseKeyFile({ bytes, passphrase }: KeyFileInput): Promise<ParsedKeyFile> {
  const { document, protection } = readDocument(bytes);
  if (protection === "passphrase") return parseProtectedKeyFile(document, passphrase);
  return parseRawKeyFile(document);
}

function equalStrings(first: string, second: string): boolean {
  const firstBytes = Buffer.from(first, "utf8");
  const secondBytes = Buffer.from(second, "utf8");
  return firstBytes.length === secondBytes.length && timingSafeEqual(firstBytes, secondBytes);
}

/**
 * Whether a key file is the key of a folder: same folder id, key id and key check, compared in
 * constant time.
 *
 * @example
 * if (!matchKeyFile(keyFile, crypto)) throw wrongKeyFile();
 */
export function matchKeyFile(
  keyFile: ParsedKeyFile,
  folder: { folderId: string; keyId: string; keyCheck: string },
): boolean {
  const isSameFolder = equalStrings(keyFile.folderId, folder.folderId);
  const isSameKeyId = equalStrings(keyFile.keyId.toString("base64"), folder.keyId);
  const isSameKey = equalStrings(computeKeyCheck(keyFile.dek, keyFile.keyId), folder.keyCheck);
  return isSameFolder && isSameKeyId && isSameKey;
}

/**
 * Whether a folder's key check is the one of an all-zero key. Early development builds wiped the
 * wizard's key before using it, so their folders were encrypted with zeros; they need a re-key.
 *
 * @example
 * if (hasAllZeroKey(scope.crypto)) status.weakKey = true;
 */
export function hasAllZeroKey(folder: { keyId: string; keyCheck: string }): boolean {
  return equalStrings(computeKeyCheck(Buffer.alloc(KEY_BYTES), Buffer.from(folder.keyId, "base64")), folder.keyCheck);
}

export function wrongKeyFile(): ApiRouteError {
  return invalidKeyFile("This key file doesn't belong to this folder.");
}
