"use client";

import { useQueryClient } from "@tanstack/react-query";
import { showToastNotification } from "@/components/interactive/toast-notification";
import { useEffect } from "react";
import { getServerEventsClient, type ServerEventMap, type ServerEventName } from "@/lib/client/events";
import { applyJobProgress, applyJobState, isActiveJob } from "@/lib/client/jobs";
import { QUERY_KEYS, readParentPath } from "@/lib/client/query-keys";
import { goToSessionPage } from "@/lib/client/session-channel";

/**
 * Starts the tab's server-event stream and turns events into cache invalidations: `fs.changed`
 * refreshes the folder listing, the entry and folder state, `drive.*` the storage list and trash
 * (and the memories, when a drive is plugged in or out),
 * `job.*` update the cached jobs (so progress bars move live), `encryption.changed` (an unlock,
 * lock or job in an encrypted folder) every listing and file of that storage, `versioning.changed`
 * its history and undo state (and badges when versioning was turned on or off).
 * Each time the stream (re)opens, the jobs are refetched: a job that ended while it was closed
 * would otherwise keep its folders busy. `protection.violation` shows a toast. `session.locked` and `session.destroyed` leave for /lock
 * or /login. Mount once, in the signed-in layout.
 *
 * @example
 * function ServerEventsBridge() {
 *   useServerEventInvalidation();
 *   return null;
 * }
 */
export function useServerEventInvalidation(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const eventsClient = getServerEventsClient();
    const stopListening = [
      eventsClient.onOpen(() => void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.jobs() })),
      eventsClient.on("fs.changed", ({ storageId, path, change }) => {
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.directory(storageId, readParentPath(path)) });
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.stat(storageId, path) });
        if (change !== "changed") void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.trash() });
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.folderState(storageId) });
      }),
      eventsClient.on("memories.changed", () => {
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.memories() });
      }),
      eventsClient.on("protection.violation", ({ storageId, path }) => {
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.folderState(storageId) });
        showToastNotification({
          title: "A protected folder was changed",
          tone: "warning",
          description: `Another program modified "${path}". CMM made it read-only again.`,
          durationInMilliseconds: 8000,
        });
      }),
      eventsClient.on("encryption.changed", ({ storageId }) => {
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.encryption(storageId) });
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.encryptedFolders() });
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.storageDirectories(storageId) });
        void queryClient.invalidateQueries({ queryKey: ["fs", "stat", storageId] });
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.folderState(storageId) });
      }),
      eventsClient.on("versioning.changed", ({ storageId, change }) => {
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.versioning(storageId) });
        if (change === "commit") return;
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.storageDirectories(storageId) });
        void queryClient.invalidateQueries({ queryKey: ["fs", "stat", storageId] });
      }),
      ...(["drive.added", "drive.removed", "drive.updated"] as const).map((eventName) =>
        eventsClient.on(eventName, () => {
          void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.storages() });
          void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.trash() });
          // A drive's memories come and go with it (capacity updates don't change them).
          if (eventName !== "drive.updated") void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.memories() });
        }),
      ),
      eventsClient.on("job.progress", ({ jobId, progress }) => applyJobProgress(queryClient, jobId, progress)),
      eventsClient.on("job.state", ({ job }) => {
        applyJobState(queryClient, job);
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.jobs() });
        // A finished move frees its source and destination folders: show what is there now.
        if (job.locks && !isActiveJob(job)) {
          for (const lock of job.locks) {
            void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.directory(lock.storageId, lock.path) });
          }
        }
        if (job.type === "backup.run") {
          void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.backup() });
          // A memory backup makes a memory on its destination.
          if (job.transfer?.memory) void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.memories() });
        }
      }),
      eventsClient.on("session.locked", () => goToSessionPage("/lock")),
      eventsClient.on("session.destroyed", () => goToSessionPage("/login")),
    ];
    eventsClient.start();
    return () => {
      for (const stop of stopListening) stop();
      eventsClient.stop();
    };
  }, [queryClient]);
}

/**
 * Watches a folder while the component is mounted and `isEnabled` is true, so changes made
 * outside CMM refresh its listing.
 *
 * @example
 * useDirectoryWatch(storageId, "notes", isExpanded);
 */
export function useDirectoryWatch(storageId: string, directoryPath: string, isEnabled = true): void {
  useEffect(() => {
    if (!isEnabled) return;
    return getServerEventsClient().watch(storageId, directoryPath);
  }, [storageId, directoryPath, isEnabled]);
}

/**
 * Subscribes to one server event while mounted.
 *
 * @example
 * useServerEvent("job.progress", ({ jobId, progress }) => setProgress(jobId, progress));
 */
export function useServerEvent<EventName extends ServerEventName>(
  eventName: EventName,
  listener: (eventData: ServerEventMap[EventName]) => void,
): void {
  useEffect(() => getServerEventsClient().on(eventName, listener), [eventName, listener]);
}
