"use client";

import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { Modal, ModalBody, ModalFooter } from "@/components/interactive/modal";
import { Button } from "@/components/primitives/button";
import {
  confirmLeave,
  hasUnsavedChanges,
  readNoPendingLeave,
  readPendingLeave,
  resolvePendingLeave,
  subscribeToPendingLeave,
} from "@/lib/client/unsaved-changes";

/** A same-origin link click that would leave the page through the router. */
function readInternalLinkHref(clickEvent: MouseEvent): string | undefined {
  if (clickEvent.defaultPrevented || clickEvent.button !== 0) return undefined;
  if (clickEvent.metaKey || clickEvent.ctrlKey || clickEvent.shiftKey || clickEvent.altKey) return undefined;
  const anchor = (clickEvent.target as Element | null)?.closest?.("a[href]");
  if (!(anchor instanceof HTMLAnchorElement) || (anchor.target && anchor.target !== "_self")) return undefined;
  if (anchor.hasAttribute("download")) return undefined;
  const targetUrl = new URL(anchor.href, window.location.href);
  if (targetUrl.origin !== window.location.origin) return undefined;
  if (targetUrl.pathname === window.location.pathname && targetUrl.search === window.location.search) return undefined;
  return `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
}

/**
 * Keeps unsaved edits from being lost: asks Save, Discard or Cancel before following an
 * in-app link or when `confirmLeave` is called (selecting another file, leaving edit mode), and
 * lets the browser warn before closing or reloading the tab. Mount once beside the editor.
 *
 * @example
 * <UnsavedChangesGuard />
 */
export function UnsavedChangesGuard() {
  const router = useRouter();
  const pendingLeave = useSyncExternalStore(subscribeToPendingLeave, readPendingLeave, readNoPendingLeave);

  useEffect(() => {
    const handleBeforeUnload = (unloadEvent: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges()) return;
      unloadEvent.preventDefault();
      unloadEvent.returnValue = "";
    };
    const handleClick = (clickEvent: MouseEvent) => {
      if (!hasUnsavedChanges()) return;
      const href = readInternalLinkHref(clickEvent);
      if (href === undefined) return;
      clickEvent.preventDefault();
      clickEvent.stopPropagation();
      confirmLeave(() => router.push(href));
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleClick, true);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleClick, true);
    };
  }, [router]);

  if (!pendingLeave) return null;
  return (
    <Modal isOpen isStatic title={`Save changes to “${pendingLeave.fileName}”?`} size="large">
      <div data-testid="unsaved-changes-dialog">
        <ModalBody>
          <p className="leading-relaxed text-foreground-muted">
            Your changes will be lost if you don&rsquo;t save them.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="outline-secondary"
            onClick={() => void resolvePendingLeave("cancel")}
            disabled={pendingLeave.isSaving}
          >
            Cancel
          </Button>
          <Button
            variant="outline-danger"
            onClick={() => void resolvePendingLeave("discard")}
            disabled={pendingLeave.isSaving}
            data-testid="unsaved-discard"
          >
            Discard
          </Button>
          <Button
            variant="primary"
            onClick={() => void resolvePendingLeave("save")}
            disabled={pendingLeave.isSaving}
            data-testid="unsaved-save"
          >
            {pendingLeave.isSaving ? "Saving…" : "Save"}
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  );
}
