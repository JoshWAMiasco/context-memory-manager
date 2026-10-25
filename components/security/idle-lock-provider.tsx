"use client";

import { useEffect, type ReactNode } from "react";
import { showToastNotification } from "@/components/interactive/toast-notification";
import {
  goToSessionPage,
  navigateWithFullReload,
  openSessionChannel,
  type SessionChannelMessage,
} from "@/lib/client/session-channel";
import { hasUnsavedChanges, hasUnsavedEncryptedChanges } from "@/lib/client/unsaved-changes";

const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;
const MAXIMUM_PING_INTERVAL_MILLISECONDS = 60_000;
const BROADCAST_INTERVAL_MILLISECONDS = 5000;
const IDLE_CHECK_INTERVAL_MILLISECONDS = 1000;
/** With unsaved edits open, a warning shows this long before the session locks. */
const LOCK_WARNING_MILLISECONDS = 30_000;

async function postSessionRequest(requestPath: string): Promise<number> {
  try {
    const response = await fetch(requestPath, {
      method: "POST",
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    return response.status;
  } catch {
    return 0;
  }
}

/**
 * Locks the session after `autoLockSeconds` without real user activity (pointer, keyboard, wheel,
 * touch, or the tab becoming visible). Activity is pinged to `/api/auth/activity` at most once a
 * minute and only after real activity. Tabs share activity and lock state over
 * `BroadcastChannel("cmm-session")`. With unsaved edits open, a toast warns 30 seconds before the
 * lock that they will be lost ("Unsaved changes in encrypted file will be lost" for a file in an
 * encrypted folder).
 *
 * @example
 * <IdleLockProvider autoLockSeconds={900}>{children}</IdleLockProvider>
 */
export function IdleLockProvider({ autoLockSeconds, children }: { autoLockSeconds: number; children: ReactNode }) {
  useEffect(() => {
    const idleLimitMilliseconds = autoLockSeconds * 1000;
    const pingIntervalMilliseconds = Math.min(
      MAXIMUM_PING_INTERVAL_MILLISECONDS,
      Math.max(1000, idleLimitMilliseconds / 2),
    );
    const sessionChannel = openSessionChannel();
    let lastActivityAt = Date.now();
    let lastPingAt = 0;
    let lastBroadcastAt = 0;
    let isLeaving = false;
    let hasWarned = false;

    const leaveFor = (pagePath: "/lock" | "/login") => {
      if (isLeaving) return;
      isLeaving = true;
      goToSessionPage(pagePath);
    };

    const pingActivity = async () => {
      const status = await postSessionRequest("/api/auth/activity");
      if (status === 423) leaveFor("/lock");
      if (status === 401) leaveFor("/login");
    };

    const recordActivity = (shouldBroadcast: boolean) => {
      const now = Date.now();
      lastActivityAt = now;
      hasWarned = false;
      if (shouldBroadcast && now - lastPingAt >= pingIntervalMilliseconds) {
        lastPingAt = now;
        void pingActivity();
      }
      if (shouldBroadcast && now - lastBroadcastAt >= BROADCAST_INTERVAL_MILLISECONDS) {
        lastBroadcastAt = now;
        sessionChannel?.postMessage({ type: "activity" } satisfies SessionChannelMessage);
      }
    };

    const lockNow = async () => {
      if (isLeaving) return;
      sessionChannel?.postMessage({ type: "locked" } satisfies SessionChannelMessage);
      await postSessionRequest("/api/auth/lock");
      leaveFor("/lock");
    };

    const handleUserActivity = () => recordActivity(true);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") recordActivity(true);
    };
    const handleChannelMessage = (messageEvent: MessageEvent<SessionChannelMessage>) => {
      if (messageEvent.data.type === "activity") recordActivity(false);
      if (messageEvent.data.type === "locked") leaveFor("/lock");
      if (messageEvent.data.type === "signed-out" && !isLeaving) {
        isLeaving = true;
        navigateWithFullReload("/login");
      }
    };

    // Capture phase: a terminal or editor stops the keys it handles from bubbling, and they still count.
    for (const eventName of ACTIVITY_EVENTS) {
      window.addEventListener(eventName, handleUserActivity, { passive: true, capture: true });
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    sessionChannel?.addEventListener("message", handleChannelMessage);
    const idleTimer = window.setInterval(() => {
      const idleMilliseconds = Date.now() - lastActivityAt;
      if (idleMilliseconds >= idleLimitMilliseconds) {
        void lockNow();
        return;
      }
      const isNearLock =
        idleLimitMilliseconds > 2 * LOCK_WARNING_MILLISECONDS &&
        idleMilliseconds >= idleLimitMilliseconds - LOCK_WARNING_MILLISECONDS;
      if (isNearLock && !hasWarned && hasUnsavedChanges()) {
        hasWarned = true;
        showToastNotification({
          title: "CMM locks in 30 seconds",
          tone: "warning",
          description: hasUnsavedEncryptedChanges()
            ? "Unsaved changes in encrypted file will be lost. Save now, or move the mouse to stay."
            : "Unsaved changes will be lost. Save now, or move the mouse to stay.",
          durationInMilliseconds: LOCK_WARNING_MILLISECONDS,
        });
      }
    }, IDLE_CHECK_INTERVAL_MILLISECONDS);

    return () => {
      for (const eventName of ACTIVITY_EVENTS) {
        window.removeEventListener(eventName, handleUserActivity, { capture: true });
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      sessionChannel?.removeEventListener("message", handleChannelMessage);
      sessionChannel?.close();
      window.clearInterval(idleTimer);
    };
  }, [autoLockSeconds]);

  return children;
}
