"use client";

import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { Redo2, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { showToastNotification } from "@/components/interactive/toast-notification";
import { announceError, useExplorer } from "@/components/explorer/explorer-context";
import { PaneAction } from "@/components/viewer/pane-header";
import { ApiError } from "@/lib/client/api";
import { useVersioningMutations, useVersioningStatus } from "@/lib/client/versioning";

dayjs.extend(relativeTime);

/** How long "Undone: Edit notes.md" stays next to the buttons (a toast would cover them). */
const RESULT_MILLISECONDS = 4000;

/**
 * Undo and Redo for a versioned folder, in the file pane header and the folder overview.
 * They work on the folder's history, not the editor's: each is a new commit. Tooltips say what
 * they would do ("Undo: Edit notes.md · 2 min ago") or why they are off; what was just undone shows
 * next to them for a few seconds. A conflict offers the history instead. Nothing is rendered outside versioned folders. There is no keyboard shortcut:
 * Cmd/Ctrl+Z stays the editor's own undo.
 *
 * @example
 * <UndoRedoButtons path={entry.path} busyReason={isDirty ? "Save first." : undefined} />
 */
export function UndoRedoButtons({ path: entryPath, busyReason }: { path: string; busyReason?: string }) {
  const explorer = useExplorer();
  const { storage } = explorer;
  const { data: status } = useVersioningStatus(storage.id, entryPath);
  const { undo, redo } = useVersioningMutations();
  const [lastResult, setLastResult] = useState<string>();
  useEffect(() => {
    if (!lastResult) return;
    const timer = setTimeout(() => setLastResult(undefined), RESULT_MILLISECONDS);
    return () => clearTimeout(timer);
  }, [lastResult]);
  if (!status?.versioned) return null;
  const peek = status.peek ?? { canUndo: false, canRedo: false };
  const blockedReason = busyReason ?? peek.blockedReason ?? explorer.readOnlyReason;
  const isRunning = undo.isPending || redo.isPending;

  const run = async (action: "undo" | "redo") => {
    try {
      const result = await (action === "undo" ? undo : redo).mutateAsync({ storageId: storage.id, path: entryPath });
      setLastResult(`${action === "undo" ? "Undone" : "Redone"}: ${result.message.replace(/^(Undo|Redo): /, "")}`);
    } catch (runError) {
      if (runError instanceof ApiError && runError.code === "UNDO_CONFLICT") {
        showToastNotification({
          title: action === "undo" ? "Couldn't undo" : "Couldn't redo",
          tone: "error",
          description: runError.message,
          durationInMilliseconds: 10_000,
          actions: (
            <button
              type="button"
              className="cursor-pointer text-brand hover:underline"
              onClick={() => explorer.openHistory(status.scopePath)}
            >
              Open history
            </button>
          ),
        });
        return;
      }
      announceError(action === "undo" ? "Couldn't undo" : "Couldn't redo", runError);
    }
  };

  const describe = (label: string | undefined, madeAt: string | undefined, verb: string) =>
    label ? `${verb}: ${label}${madeAt ? ` · ${dayjs(madeAt).fromNow()}` : ""}` : `Nothing to ${verb.toLowerCase()}`;
  const undoLabel = describe(peek.undoLabel, peek.undoAt, "Undo");
  const redoLabel = describe(peek.redoLabel, peek.redoAt, "Redo");
  return (
    <span className="flex items-center" data-testid="undo-redo-buttons">
      <span
        className="mr-1 max-w-48 truncate text-xs text-foreground-subtle"
        role="status"
        aria-live="polite"
        data-testid="history-result"
      >
        {lastResult}
      </span>
      <PaneAction
        label={undoLabel}
        icon={Undo2}
        testId="history-undo"
        disabledReason={blockedReason ?? (isRunning ? "Working…" : peek.canUndo ? undefined : undoLabel)}
        onClick={() => void run("undo")}
      />
      <PaneAction
        label={redoLabel}
        icon={Redo2}
        testId="history-redo"
        disabledReason={blockedReason ?? (isRunning ? "Working…" : peek.canRedo ? undefined : redoLabel)}
        onClick={() => void run("redo")}
      />
    </span>
  );
}
