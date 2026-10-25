/*
 * The unsaved-changes guard. The open editor registers itself; anything that would leave
 * it (selecting another file, following a link, leaving edit mode) goes through `confirmLeave`,
 * which asks Save, Discard or Cancel while there are unsaved changes.
 */

export interface UnsavedDocument {
  fileName: string;
  /** In an encrypted folder: a session lock throws its unsaved edits away. */
  isEncrypted?: boolean;
  isDirty: () => boolean;
  /** Saves; resolves false when saving failed or was cancelled (a conflict, for example). */
  save: () => Promise<boolean>;
  /** Throws away the changes. */
  discard: () => void;
}

export interface PendingLeave {
  fileName: string;
  isSaving: boolean;
}

type LeaveChoice = "save" | "discard" | "cancel";

let activeDocument: UnsavedDocument | undefined;
let pendingLeave: PendingLeave | undefined;
let pendingProceed: (() => void) | undefined;
const listeners = new Set<() => void>();

function setPendingLeave(nextPendingLeave: PendingLeave | undefined): void {
  pendingLeave = nextPendingLeave;
  for (const listener of listeners) listener();
}

/**
 * Registers the open editor; returns the function that unregisters it.
 *
 * @example
 * useEffect(() => registerUnsavedDocument({ fileName, isDirty, save, discard }), [fileName, isDirty, save, discard]);
 */
export function registerUnsavedDocument(document: UnsavedDocument): () => void {
  activeDocument = document;
  return () => {
    if (activeDocument === document) activeDocument = undefined;
  };
}

/** Whether the open editor has changes that aren't saved. */
export function hasUnsavedChanges(): boolean {
  return activeDocument?.isDirty() ?? false;
}

/** Whether the open editor has unsaved changes to a file in an encrypted folder. */
export function hasUnsavedEncryptedChanges(): boolean {
  return activeDocument?.isEncrypted === true && activeDocument.isDirty();
}

/**
 * Runs `proceed` now when nothing is unsaved; otherwise asks first and runs it after Save or
 * Discard (never after Cancel).
 *
 * @example
 * confirmLeave(() => selectPath(nextPath));
 */
export function confirmLeave(proceed: () => void): void {
  if (!activeDocument?.isDirty()) {
    proceed();
    return;
  }
  pendingProceed = proceed;
  setPendingLeave({ fileName: activeDocument.fileName, isSaving: false });
}

/** Answers the pending question. */
export async function resolvePendingLeave(choice: LeaveChoice): Promise<void> {
  const proceed = pendingProceed;
  if (!pendingLeave || !proceed) return;
  if (choice === "cancel") {
    pendingProceed = undefined;
    setPendingLeave(undefined);
    return;
  }
  if (choice === "save" && activeDocument) {
    setPendingLeave({ ...pendingLeave, isSaving: true });
    const isSaved = await activeDocument.save();
    if (!isSaved) {
      pendingProceed = undefined;
      setPendingLeave(undefined);
      return;
    }
  } else {
    activeDocument?.discard();
  }
  pendingProceed = undefined;
  setPendingLeave(undefined);
  proceed();
}

/** For `useSyncExternalStore`. */
export function subscribeToPendingLeave(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** For `useSyncExternalStore`. */
export function readPendingLeave(): PendingLeave | undefined {
  return pendingLeave;
}

/** The server snapshot for `useSyncExternalStore`: nothing pending. */
export function readNoPendingLeave(): PendingLeave | undefined {
  return undefined;
}
