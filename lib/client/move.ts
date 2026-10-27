import type { StoragePath } from "@/lib/client/fs";
import { isInsideFolder, readParentPath } from "@/lib/client/query-keys";

/**
 * Why `sources` can't be moved into `destination`, or undefined when they can: a folder into
 * itself or a folder inside it, a move to where the items already are, or a folder a running
 * move keeps busy.
 *
 * @example
 * findMoveProblem([{ storageId: "home", path: "notes" }], { storageId: "home", path: "notes/2026" }, new Set());
 * // "A folder can't be moved into itself."
 */
export function findMoveProblem(
  sources: readonly StoragePath[],
  destination: StoragePath,
  busyFolders: ReadonlySet<string>,
): string | undefined {
  if (sources.length === 0) return "Choose something to move.";
  const isIntoItself = sources.some(
    (source) => source.storageId === destination.storageId && isInsideFolder(destination.path, source.path),
  );
  if (isIntoItself) return "A folder can't be moved into itself.";
  const isAlreadyThere = sources.every(
    (source) => source.storageId === destination.storageId && readParentPath(source.path) === destination.path,
  );
  if (isAlreadyThere) return `The item${sources.length === 1 ? " is" : "s are"} already in this folder.`;
  for (const busyFolder of busyFolders) {
    if (isInsideFolder(destination.path, busyFolder)) return "Files are being moved here. Wait for the move to finish.";
  }
  return undefined;
}
