import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ApiRouteError } from "@/server/http/api-error";
import { KEY_BYTES, KEY_ID_BYTES } from "@/server/crypto/format";

/** Key files are under 1 KB; anything over 4 KB is refused before parsing. */
export const MAX_KEY_FILE_BYTES = 4096;
export const KEY_FILE_EXTENSION = ".ccmkey";

const KEY_CHECK_LABEL = Buffer.from("ccm/keycheck/v1", "utf8");

export interface FolderKey {
  dek: Buffer;
  keyId: Buffer;
}

/** What a key file holds once parsed. `dek` is secret: never log or return it. */
export interface ParsedKeyFile extends FolderKey {
  folderId: string;
  folderName: string;
  createdAt: string;
}

const base64Schema = (byteLength: number) =>
  z
    .string()
    .regex(/^[A-Za-z0-9+/]+={0,2}$/)
    .refine((value) => Buffer.from(value, "base64").length === byteLength, `Must be ${byteLength} bytes.`);

const keyFileSchema = z.object({
  v: z.literal(1),
  type: z.literal("ccm-key"),
  folderId: z.uuid(),
  keyId: base64Schema(KEY_ID_BYTES),
  folderName: z.string().max(255),
  createdAt: z.string().max(64),
  key: base64Schema(KEY_BYTES),
  checksum: z.string().regex(/^[\da-f]{16}$/),
});

/** A new random folder key: a 32-byte DEK and a 16-byte key id. */
export function generateFolderKey(): FolderKey {
  return { dek: randomBytes(KEY_BYTES), keyId: randomBytes(KEY_ID_BYTES) };
}

function computeChecksum(dek: Buffer, keyId: Buffer): string {
  return createHash("sha256").update(dek).update(keyId).digest().subarray(0, 8).toString("hex");
}

/**
 * The `keyCheck` stored in `.ccm/crypto.json`: base64 HMAC-SHA256(DEK, "ccm/keycheck/v1" || keyId).
 * It proves an uploaded key is the folder's key without decrypting a file, and reveals nothing
 * about the key.
 */
export function computeKeyCheck(dek: Buffer, keyId: Buffer): string {
  return createHmac("sha256", dek).update(KEY_CHECK_LABEL).update(keyId).digest("base64");
}

/**
 * The `.ccmkey` file for a folder key, as JSON bytes.
 *
 * @example
 * const keyFileBytes = buildKeyFile({ folderId, folderName: "persona", createdAt, ...generateFolderKey() });
 */
export function buildKeyFile(keyFile: ParsedKeyFile): Buffer {
  const document = {
    v: 1,
    type: "ccm-key",
    folderId: keyFile.folderId,
    keyId: keyFile.keyId.toString("base64"),
    folderName: keyFile.folderName,
    createdAt: keyFile.createdAt,
    key: keyFile.dek.toString("base64"),
    checksum: computeChecksum(keyFile.dek, keyFile.keyId),
  };
  return Buffer.from(`${JSON.stringify(document, null, 2)}\n`, "utf8");
}

function invalidKeyFile(message: string): ApiRouteError {
  return new ApiRouteError(400, "WRONG_KEY_FILE", message);
}

/**
 * Reads an uploaded `.ccmkey` file: at most 4 KB, valid JSON in the v1 shape, and a checksum that
 * matches the key. Throws 400 `WRONG_KEY_FILE` otherwise.
 *
 * @example
 * const keyFile = parseKeyFile(await uploadedFile.arrayBuffer().then(Buffer.from));
 */
export function parseKeyFile(bytes: Buffer): ParsedKeyFile {
  if (bytes.length > MAX_KEY_FILE_BYTES) throw invalidKeyFile("That file is too large to be a CCM key file.");
  let document: unknown;
  try {
    document = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw invalidKeyFile("That file is not a CCM key file.");
  }
  const parsed = keyFileSchema.safeParse(document);
  if (!parsed.success) throw invalidKeyFile("That file is not a CCM key file.");
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
  };
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
