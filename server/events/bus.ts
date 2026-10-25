import "server-only";
import { EventEmitter } from "node:events";
import type { JobProgress, JobSummary } from "@/lib/api-types";
import { getGlobalSingleton } from "@/server/runtime/global-singleton";

export interface FileSystemChangedEvent {
  storageId: string;
  /** The changed entry, relative to the storage root. */
  path: string;
  change: "added" | "changed" | "removed";
}

export interface DriveEvent {
  storageId: string;
  label: string;
  available: boolean;
}

export interface JobProgressEvent {
  jobId: string;
  /** The user who started the job; the SSE route only sends a job's events to them and to admins. */
  ownerId: string | null;
  progress: JobProgress;
}

export interface JobStateEvent {
  ownerId: string | null;
  job: JobSummary;
}

export interface SessionLockedEvent {
  sessionIdHash: string;
  userId: string;
  reason: "idle" | "manual";
}

export interface SessionDestroyedEvent {
  sessionIdHash: string;
  userId: string;
  reason: "logout" | "expired" | "revoked";
}

/** A change was made inside a protected folder by something other than CCM. */
export interface ProtectionViolationEvent {
  storageId: string;
  /** The protected folder (or file). */
  scopePath: string;
  /** The changed entry. */
  path: string;
  detectedAt: string;
}

/**
 * An encrypted folder changed: a session unlocked or locked it (`sessionIdHash` set: only
 * that session hears it), or its state changed (encrypting, encrypted, decrypting, re-keying, or
 * no longer encrypted).
 */
export interface EncryptionChangedEvent {
  sessionIdHash?: string;
  storageId: string;
  /** The encrypted folder. */
  path: string;
  folderId: string;
  change: "unlocked" | "locked" | "state";
}

/**
 * A versioned folder changed: versioning was turned on or off, or a commit was made (an
 * edit, an external snapshot, an undo, redo or restore). History and the undo buttons refresh.
 */
export interface VersioningChangedEvent {
  storageId: string;
  /** The versioned folder. */
  path: string;
  change: "enabled" | "disabled" | "commit";
}

/** A backup profile started on its own because its drive was plugged in. */
export interface BackupTriggeredEvent {
  ownerId: string | null;
  profileId: string;
  name: string;
  jobId: string;
  /** The drive that was plugged in. */
  storageId: string;
}

/** Every event the bus carries, keyed by the SSE event name. */
export interface CcmEventMap {
  "fs.changed": [FileSystemChangedEvent];
  "drive.added": [DriveEvent];
  "drive.removed": [DriveEvent];
  "drive.updated": [DriveEvent];
  "job.progress": [JobProgressEvent];
  "job.state": [JobStateEvent];
  "session.locked": [SessionLockedEvent];
  "session.destroyed": [SessionDestroyedEvent];
  "protection.violation": [ProtectionViolationEvent];
  "encryption.changed": [EncryptionChangedEvent];
  "versioning.changed": [VersioningChangedEvent];
  "backup.triggered": [BackupTriggeredEvent];
}

export type CcmEventName = keyof CcmEventMap;

/** The SSE topics a client subscribes to (`/api/events?topics=fs,drives`) and the events in each. */
export const EVENT_TOPICS = {
  fs: ["fs.changed", "protection.violation", "encryption.changed", "versioning.changed"],
  drives: ["drive.added", "drive.removed", "drive.updated"],
  jobs: ["job.progress", "job.state", "backup.triggered"],
  session: ["session.locked", "session.destroyed"],
} as const satisfies Record<string, readonly CcmEventName[]>;

export type EventTopic = keyof typeof EVENT_TOPICS;

export class CcmEventBus extends EventEmitter<CcmEventMap> {
  constructor() {
    super();
    this.setMaxListeners(0);
  }
}

/** The process-wide event bus, shared by background services and the SSE route. */
export function getEventBus(): CcmEventBus {
  return getGlobalSingleton("event-bus", () => new CcmEventBus());
}
