import type { JobProgress, JobSummary } from "@/lib/api-types";

export interface ServerEventMap {
  "fs.changed": { storageId: string; path: string; change: "added" | "changed" | "removed" };
  "drive.added": { storageId: string; label: string; available: boolean };
  "drive.removed": { storageId: string; label: string; available: boolean };
  "drive.updated": { storageId: string; label: string; available: boolean };
  "job.progress": { jobId: string; progress: JobProgress };
  "job.state": { job: JobSummary };
  "session.locked": { reason: string };
  "session.destroyed": { reason: string };
  "protection.violation": { storageId: string; scopePath: string; path: string; detectedAt: string };
  "encryption.changed": { storageId: string; path: string; folderId: string; change: "unlocked" | "locked" | "state" };
  "versioning.changed": { storageId: string; path: string; change: "enabled" | "disabled" | "commit" };
  "backup.triggered": { profileId: string; name: string; jobId: string; storageId: string };
}

export type ServerEventName = keyof ServerEventMap;

type AnyListener = (eventData: never) => void;

const EVENT_NAMES = Object.keys({
  "fs.changed": 0,
  "drive.added": 0,
  "drive.removed": 0,
  "drive.updated": 0,
  "job.progress": 0,
  "job.state": 0,
  "session.locked": 0,
  "session.destroyed": 0,
  "protection.violation": 0,
  "encryption.changed": 0,
  "versioning.changed": 0,
  "backup.triggered": 0,
} satisfies Record<ServerEventName, 0>) as ServerEventName[];

const MAXIMUM_BACKOFF_MILLISECONDS = 30_000;
const REOPEN_DELAY_MILLISECONDS = 100;

/**
 * One `EventSource` per tab for `/api/events`. Folder watches are counted: adding or
 * removing one reopens the stream with the new `watch=` list. A closed stream reopens with
 * backoff (1 s doubling to 30 s), reset after each successful open.
 */
export class ServerEventsClient {
  private eventSource?: EventSource;
  private readonly watchCounts = new Map<string, number>();
  private readonly listeners = new Map<ServerEventName, Set<AnyListener>>();
  private reconnectDelay = 1000;
  private reopenTimer?: ReturnType<typeof setTimeout>;
  private isStopped = true;

  constructor(private readonly createEventSource: (url: string) => EventSource = (url) => new EventSource(url)) {}

  start(): void {
    if (!this.isStopped) return;
    this.isStopped = false;
    this.open();
  }

  stop(): void {
    this.isStopped = true;
    clearTimeout(this.reopenTimer);
    this.eventSource?.close();
    this.eventSource = undefined;
  }

  on<EventName extends ServerEventName>(
    eventName: EventName,
    listener: (eventData: ServerEventMap[EventName]) => void,
  ): () => void {
    const eventListeners = this.listeners.get(eventName) ?? new Set<AnyListener>();
    eventListeners.add(listener as AnyListener);
    this.listeners.set(eventName, eventListeners);
    return () => eventListeners.delete(listener as AnyListener);
  }

  /** Watches a folder for changes made outside CMM; returns the function that stops watching. */
  watch(storageId: string, directoryPath: string): () => void {
    const watchKey = `${storageId}:${directoryPath}`;
    this.watchCounts.set(watchKey, (this.watchCounts.get(watchKey) ?? 0) + 1);
    if (this.watchCounts.get(watchKey) === 1) this.scheduleReopen(REOPEN_DELAY_MILLISECONDS);
    let isWatching = true;
    return () => {
      if (!isWatching) return;
      isWatching = false;
      const remainingCount = (this.watchCounts.get(watchKey) ?? 1) - 1;
      if (remainingCount > 0) {
        this.watchCounts.set(watchKey, remainingCount);
        return;
      }
      this.watchCounts.delete(watchKey);
      this.scheduleReopen(REOPEN_DELAY_MILLISECONDS);
    };
  }

  /** The stream URL for the current watches. */
  buildUrl(): string {
    const searchParams = new URLSearchParams({ topics: "fs,drives,jobs" });
    for (const watchKey of [...this.watchCounts.keys()].toSorted().slice(0, 50)) searchParams.append("watch", watchKey);
    return `/api/events?${searchParams.toString()}`;
  }

  private dispatch(eventName: ServerEventName, eventData: unknown): void {
    for (const listener of this.listeners.get(eventName) ?? []) (listener as (value: unknown) => void)(eventData);
  }

  private scheduleReopen(delayMilliseconds: number): void {
    if (this.isStopped) return;
    clearTimeout(this.reopenTimer);
    this.reopenTimer = setTimeout(() => this.open(), delayMilliseconds);
  }

  private open(): void {
    if (this.isStopped) return;
    this.eventSource?.close();
    const eventSource = this.createEventSource(this.buildUrl());
    this.eventSource = eventSource;
    eventSource.addEventListener("open", () => {
      this.reconnectDelay = 1000;
    });
    for (const eventName of EVENT_NAMES) {
      eventSource.addEventListener(eventName, (messageEvent) => {
        try {
          this.dispatch(eventName, JSON.parse((messageEvent as MessageEvent<string>).data));
        } catch {
          this.dispatch(eventName, {});
        }
      });
    }
    eventSource.addEventListener("error", () => {
      if (this.eventSource !== eventSource || eventSource.readyState !== EventSource.CLOSED) return;
      this.scheduleReopen(this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAXIMUM_BACKOFF_MILLISECONDS);
    });
  }
}

let sharedClient: ServerEventsClient | undefined;

/** The tab's shared events client. */
export function getServerEventsClient(): ServerEventsClient {
  sharedClient ??= new ServerEventsClient();
  return sharedClient;
}
