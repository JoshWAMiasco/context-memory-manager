/*
 * File and folder name rules shared by the browser (inline rename, new item, upload) and the
 * server's path jail, so the client can say what is wrong before asking the server.
 * Isomorphic: no server-only imports here.
 */

import { LEGACY_RESERVED_NAMES } from "@/lib/fs/legacy-names";

/** CMM's own folders, and the names they had before (`.ccm`…), which no one may create or rename to. */
export const RESERVED_CMM_NAMES = [".cmm", ".cmm-trash", ".cmm-tmp", ...LEGACY_RESERVED_NAMES] as const;

const WINDOWS_RESERVED_NAME_PATTERN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F]/;
const MAXIMUM_NAME_BYTES = 255;

/**
 * What is wrong with `entryName` as a file or folder name, or undefined when it is fine.
 *
 * @example
 * findNameProblem("notes/today.md"); // "A name can't contain a slash."
 */
export function findNameProblem(entryName: string, { allowReserved = false } = {}): string | undefined {
  if (entryName.trim() === "") return "Enter a name.";
  if (entryName === "." || entryName === "..") return "That name is not allowed.";
  if (entryName.includes("/") || entryName.includes("\\")) return "A name can't contain a slash.";
  if (CONTROL_CHARACTER_PATTERN.test(entryName)) return "A name can't contain control characters.";
  if (WINDOWS_RESERVED_NAME_PATTERN.test(entryName)) return `"${entryName}" is a reserved name.`;
  if (entryName.endsWith(".") || entryName.endsWith(" ")) return "A name can't end with a dot or a space.";
  if (!allowReserved && RESERVED_CMM_NAMES.some((reservedName) => reservedName === entryName.toLowerCase())) {
    return `"${entryName}" is reserved for CMM.`;
  }
  if (new TextEncoder().encode(entryName).length > MAXIMUM_NAME_BYTES) return "That name is too long.";
  return undefined;
}
