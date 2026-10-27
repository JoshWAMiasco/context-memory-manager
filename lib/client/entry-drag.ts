/*
 * The drag data of entries dragged inside CMM: the tree sets it, and the tree (moves and copies)
 * and the terminal (paste the paths) read it.
 */

/** The drag data type of entries dragged inside CMM (`{ storageId, paths }`). */
export const ENTRY_DRAG_TYPE = "application/x-cmm-entries";

export interface DraggedEntries {
  storageId: string;
  paths: string[];
}

/**
 * The entries of a drag, or undefined when it isn't a drag of CMM entries.
 *
 * @example
 * const dragged = readDraggedEntries(dropEvent.dataTransfer);
 */
export function readDraggedEntries(dataTransfer: DataTransfer): DraggedEntries | undefined {
  try {
    const parsed = JSON.parse(dataTransfer.getData(ENTRY_DRAG_TYPE)) as DraggedEntries;
    return Array.isArray(parsed.paths) && typeof parsed.storageId === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}
