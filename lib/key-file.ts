/*
 * What a `.cmmkey` key file looks like from the outside, shared by the server (which reads and
 * writes them) and the browser (which only needs to know whether one asks for a passphrase).
 * Isomorphic: no server-only imports here.
 */

export const KEY_FILE_EXTENSION = ".cmmkey";
/** The raw copy of a passphrase-protected key, for the drawer or safe: `name.recovery.cmmkey`. */
export const RECOVERY_KEY_FILE_SUFFIX = ".recovery";

export const KEY_FILE_PASSPHRASE_MINIMUM_LENGTH = 8;
export const KEY_FILE_PASSPHRASE_MAXIMUM_LENGTH = 1024;

/**
 * `raw`: the v1 file holds the key itself. `passphrase`: the v2 file holds the key wrapped with a
 * passphrase, which is needed to use it. `unknown`: not a CMM key file (the server says why).
 */
export type KeyFileProtection = "raw" | "passphrase" | "unknown";

/**
 * Which kind of key file `text` is, from its version field alone; the server validates the rest.
 *
 * @example
 * if (readKeyFileProtection(await file.text()) === "passphrase") askForPassphrase();
 */
export function readKeyFileProtection(text: string): KeyFileProtection {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return "unknown";
  }
  if (typeof document !== "object" || document === null) return "unknown";
  const version = (document as { v?: unknown }).v;
  if (version === 1) return "raw";
  if (version === 2) return "passphrase";
  return "unknown";
}

/** Why `passphrase` can't protect a key file, or undefined when it can. */
export function findKeyFilePassphraseProblem(passphrase: string): string | undefined {
  if (passphrase.length < KEY_FILE_PASSPHRASE_MINIMUM_LENGTH)
    return `Use at least ${KEY_FILE_PASSPHRASE_MINIMUM_LENGTH} characters.`;
  if (passphrase.length > KEY_FILE_PASSPHRASE_MAXIMUM_LENGTH) return "This passphrase is too long.";
  return undefined;
}
