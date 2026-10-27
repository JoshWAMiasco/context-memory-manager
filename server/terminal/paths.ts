import "server-only";
import { formatDroppedPaths, readShellQuoting } from "@/lib/terminal";
import { ApiRouteError, validationFailed } from "@/server/http/api-error";
import { readAbsolutePath } from "@/server/storage/fs-ops";
import type { FileActor } from "@/server/storage/pipeline";
import type { ActiveStorage } from "@/server/storage/roots";
import { readTerminalAvailability, requireTerminal } from "@/server/terminal";

/**
 * The text to paste into a terminal for entries dropped on it: their absolute paths, quoted for
 * the terminal's shell. Only for the terminal's owner while they may use terminals: a server
 * otherwise never tells a browser where its files live, but this user already has a shell on that
 * machine. Every path goes through the path jail and the read guards.
 *
 * @example
 * const { text } = await buildDroppedPathText(actor, "4f1c…", storage, ["notes/today.md"]);
 */
export async function buildDroppedPathText(
  actor: FileActor,
  terminalId: string,
  storage: ActiveStorage,
  entryPaths: readonly string[],
): Promise<{ text: string }> {
  const availability = readTerminalAvailability(actor);
  if (!availability.available) {
    throw new ApiRouteError(403, "FORBIDDEN", availability.reason ?? "Terminals are not available.");
  }
  const session = requireTerminal(actor, terminalId);
  const absolutePaths: string[] = [];
  for (const entryPath of entryPaths) absolutePaths.push(await readAbsolutePath(storage, entryPath, actor));
  try {
    return { text: formatDroppedPaths(absolutePaths, readShellQuoting(session.summary.shell)) };
  } catch (quoteError) {
    throw validationFailed(quoteError instanceof Error ? quoteError.message : "That path can't be pasted.");
  }
}
