import "server-only";
import type { NextRequest } from "next/server";
import { resolveSession, SESSION_COOKIE_NAME, type ResolvedSession } from "@/server/auth/session";
import { getEventBus, type CmmEventMap, type CmmEventName, type EventTopic } from "@/server/events/bus";
import { validationFailed } from "@/server/http/api-error";
import type { FileActor } from "@/server/storage/pipeline";
import { canSeeStorage, requireStorageAccess } from "@/server/storage/roots";
import { subscribeToDirectory } from "@/server/storage/watcher";

export const HEARTBEAT_MILLISECONDS = 25_000;
export const MAX_WATCHES_PER_STREAM = 50;
const VISIBILITY_CACHE_MILLISECONDS = 10_000;

const SUBSCRIBABLE_TOPICS = ["fs", "drives", "jobs"] as const satisfies readonly EventTopic[];

/** Reads `?topics=fs,drives,jobs` (default: all three). Session events are always sent. */
export function readTopics(topicsText: string | null): Set<EventTopic> {
  const requestedTopics = (topicsText ?? SUBSCRIBABLE_TOPICS.join(","))
    .split(",")
    .map((topic) => topic.trim())
    .filter(Boolean);
  const topics = new Set<EventTopic>(["session"]);
  for (const requestedTopic of requestedTopics) {
    if (!(SUBSCRIBABLE_TOPICS as readonly string[]).includes(requestedTopic)) {
      throw validationFailed(`Unknown event topic "${requestedTopic}".`);
    }
    topics.add(requestedTopic as EventTopic);
  }
  return topics;
}

/** Reads repeatable `?watch=<storageId>:<path>` values. */
export function readWatchTargets(watchValues: readonly string[]): { storageId: string; path: string }[] {
  if (watchValues.length > MAX_WATCHES_PER_STREAM) throw validationFailed("Too many watched folders.");
  return watchValues.map((watchValue) => {
    const separatorIndex = watchValue.indexOf(":");
    if (separatorIndex <= 0) throw validationFailed("A watch target looks like <storageId>:<path>.");
    return { storageId: watchValue.slice(0, separatorIndex), path: watchValue.slice(separatorIndex + 1) };
  });
}

interface EventStreamOptions {
  request: NextRequest;
  auth: ResolvedSession;
  actor: FileActor;
}

/**
 * The SSE stream behind `GET /api/events`. Events are filtered to what the user may
 * see: fs and drive events by storage access, job events by owner (admins see all), session
 * events by session. A heartbeat every 25 seconds keeps proxies from closing the connection and
 * re-checks the session without counting as activity; the stream ends when the session is
 * locked, signed out or expired. Closing the stream releases its folder watchers.
 */
export async function createEventStream({
  request,
  auth,
  actor,
}: EventStreamOptions): Promise<ReadableStream<Uint8Array>> {
  const topics = readTopics(request.nextUrl.searchParams.get("topics"));
  const watchTargets = readWatchTargets(request.nextUrl.searchParams.getAll("watch"));
  const unsubscribers: (() => Promise<void>)[] = [];
  try {
    for (const watchTarget of watchTargets) {
      const watchedStorage = requireStorageAccess(actor, watchTarget.storageId, "read");
      unsubscribers.push(await subscribeToDirectory(watchedStorage, watchTarget.path));
    }
  } catch (watchError) {
    await Promise.all(unsubscribers.map((unsubscribe) => unsubscribe()));
    throw watchError;
  }

  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const visibilityCache = new Map<string, { visible: boolean; checkedAt: number }>();
  const isStorageVisible = (storageId: string) => {
    const cachedVisibility = visibilityCache.get(storageId);
    if (cachedVisibility && Date.now() - cachedVisibility.checkedAt < VISIBILITY_CACHE_MILLISECONDS) {
      return cachedVisibility.visible;
    }
    const visible = canSeeStorage(actor, storageId);
    visibilityCache.set(storageId, { visible, checkedAt: Date.now() });
    return visible;
  };
  const isWanted: { [EventName in CmmEventName]: (...eventArguments: CmmEventMap[EventName]) => boolean } = {
    "fs.changed": (event) => topics.has("fs") && isStorageVisible(event.storageId),
    "protection.violation": (event) => topics.has("fs") && isStorageVisible(event.storageId),
    "versioning.changed": (event) => topics.has("fs") && isStorageVisible(event.storageId),
    "encryption.changed": (event) =>
      topics.has("fs") &&
      (event.sessionIdHash === undefined
        ? isStorageVisible(event.storageId)
        : event.sessionIdHash === auth.session.idHash),
    "drive.added": (event) => topics.has("drives") && isStorageVisible(event.storageId),
    "drive.removed": (event) => topics.has("drives") && isStorageVisible(event.storageId),
    "drive.updated": (event) => topics.has("drives") && isStorageVisible(event.storageId),
    "job.progress": (event) => topics.has("jobs") && (actor.role === "admin" || event.ownerId === actor.id),
    "job.state": (event) => topics.has("jobs") && (actor.role === "admin" || event.ownerId === actor.id),
    "backup.triggered": (event) => topics.has("jobs") && (actor.role === "admin" || event.ownerId === actor.id),
    "session.locked": (event) => event.sessionIdHash === auth.session.idHash,
    "session.destroyed": (event) => event.sessionIdHash === auth.session.idHash,
  };
  const toClientPayload = (eventName: CmmEventName, eventValue: unknown): unknown => {
    if (eventName === "job.progress" || eventName === "job.state" || eventName === "backup.triggered") {
      const clientValue: Record<string, unknown> = { ...(eventValue as Record<string, unknown>) };
      delete clientValue.ownerId;
      return clientValue;
    }
    if (eventName === "encryption.changed") {
      const clientValue: Record<string, unknown> = { ...(eventValue as Record<string, unknown>) };
      delete clientValue.sessionIdHash;
      return clientValue;
    }
    if (eventName === "session.locked" || eventName === "session.destroyed") {
      return { reason: (eventValue as { reason: string }).reason };
    }
    return eventValue;
  };

  const encoder = new TextEncoder();
  const eventBus = getEventBus();
  const cleanup: {
    done: boolean;
    listeners: [CmmEventName, (...eventArguments: never[]) => void][];
    heartbeat?: NodeJS.Timeout;
  } = {
    done: false,
    listeners: [],
  };
  const stop = () => {
    if (cleanup.done) return;
    cleanup.done = true;
    clearInterval(cleanup.heartbeat);
    for (const [eventName, listener] of cleanup.listeners) eventBus.off(eventName, listener as never);
    for (const unsubscribe of unsubscribers) {
      unsubscribe().catch((closeError: unknown) => console.warn("[cmm] closing a watcher failed", closeError));
    }
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (text: string) => {
        if (cleanup.done) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          stop();
        }
      };
      const close = () => {
        if (cleanup.done) return;
        stop();
        try {
          controller.close();
        } catch {
          stop();
        }
      };
      write("retry: 3000\n: connected\n\n");
      const eventNames = Object.keys(isWanted) as CmmEventName[];
      for (const eventName of eventNames) {
        const listener = (...eventArguments: never[]) => {
          const wants = isWanted[eventName] as (...values: unknown[]) => boolean;
          if (!wants(...eventArguments)) return;
          write(`event: ${eventName}\ndata: ${JSON.stringify(toClientPayload(eventName, eventArguments[0]))}\n\n`);
          if (eventName === "session.locked" || eventName === "session.destroyed") close();
        };
        cleanup.listeners.push([eventName, listener]);
        eventBus.on(eventName, listener as never);
      }
      cleanup.heartbeat = setInterval(() => {
        const currentSession = resolveSession(sessionToken);
        if (!currentSession || currentSession.isLocked) {
          const eventName = currentSession ? "session.locked" : "session.destroyed";
          write(`event: ${eventName}\ndata: ${JSON.stringify({ reason: currentSession ? "idle" : "expired" })}\n\n`);
          close();
          return;
        }
        write(": heartbeat\n\n");
      }, HEARTBEAT_MILLISECONDS);
      request.signal.addEventListener("abort", close, { once: true });
    },
    cancel() {
      stop();
    },
  });
}
