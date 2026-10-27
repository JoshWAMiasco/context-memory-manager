import "server-only";
import { statSync } from "node:fs";
import path from "node:path";

/**
 * The shell's PATH with `~/.local/bin` in front when that folder exists and isn't on it yet. Claude
 * Code's installer (and pipx, uv and others) put commands there, and on a server the `cmm` user has
 * no `.profile` that adds it, so `claude` would be "command not found" in a terminal.
 *
 * @example
 * withUserBinOnPath("/usr/bin:/bin", "/var/lib/cmm"); // "/var/lib/cmm/.local/bin:/usr/bin:/bin"
 */
export function withUserBinOnPath(
  pathValue: string | undefined,
  homeDirectory: string | undefined,
  isDirectory: (directoryPath: string) => boolean = isExistingDirectory,
): string | undefined {
  if (!homeDirectory) return pathValue;
  const userBinDirectory = path.join(homeDirectory, ".local", "bin");
  const pathEntries = (pathValue ?? "").split(path.delimiter).filter(Boolean);
  if (pathEntries.includes(userBinDirectory) || !isDirectory(userBinDirectory)) return pathValue;
  return [userBinDirectory, ...pathEntries].join(path.delimiter);
}

function isExistingDirectory(directoryPath: string): boolean {
  try {
    return statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}
