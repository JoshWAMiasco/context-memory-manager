import "server-only";
import { randomInt } from "node:crypto";

export const SETUP_CODE_FILE_NAME = "setup-code";

/** Unambiguous characters: no 0/O or 1/I/L. */
const SETUP_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** A new one-time setup code, three groups of four characters such as `7KQ2-MWXR-9HPT`. Shared with the `ccm` CLI. */
export function generateSetupCode(): string {
  const codeCharacters = Array.from({ length: 12 }, () => SETUP_CODE_ALPHABET[randomInt(SETUP_CODE_ALPHABET.length)]);
  return [codeCharacters.slice(0, 4), codeCharacters.slice(4, 8), codeCharacters.slice(8)]
    .map((codePart) => codePart.join(""))
    .join("-");
}
