import "server-only";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, open, rename, rm, stat, utimes } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getGlobalSingleton } from "@/server/runtime/global-singleton";

/** Read and write in 1 MiB pieces: big enough for USB throughput, small enough for smooth progress. */
export const COPY_CHUNK_BYTES = 1024 * 1024;

/** A file being copied is written next to its final name with this suffix, then renamed. */
export const PART_SUFFIX = ".cmm-part";

/** Windows paths this long need the `\\?\` prefix. */
const WINDOWS_PATH_LIMIT = 260;

/** How quickly the speed follows changes: 0.3 of each new sample. */
const SPEED_SMOOTHING = 0.3;
const SPEED_SAMPLE_MILLISECONDS = 250;

export type CopyErrorKind = "no-space" | "io" | "missing" | "access" | "verify" | "other";

/** A copy failure, classified so the job can decide: stop (no space), pause (drive gone) or note it and go on. */
export class BackupCopyError extends Error {
  constructor(
    readonly kind: CopyErrorKind,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "BackupCopyError";
  }
}

const ERROR_KINDS: Record<string, CopyErrorKind> = {
  ENOSPC: "no-space",
  EDQUOT: "no-space",
  EFBIG: "no-space",
  EIO: "io",
  ENXIO: "io",
  ENODEV: "io",
  ENOENT: "missing",
  EACCES: "access",
  EPERM: "access",
  EROFS: "access",
};

const KIND_MESSAGES: Record<CopyErrorKind, string> = {
  "no-space": "There is not enough free space on the destination.",
  io: "The drive reported a read or write error.",
  missing: "The file disappeared while it was being copied.",
  access: "The operating system denied access.",
  verify: "The copy didn't match the original after writing.",
  other: "The file couldn't be copied.",
};

/**
 * Turns a file system error into a `BackupCopyError` with a plain message (ENOSPC, EIO, ENOENT,
 * EACCES, …).
 *
 * @example
 * classifyCopyError(Object.assign(new Error("x"), { code: "ENOSPC" })).kind; // "no-space"
 */
export function classifyCopyError(copyError: unknown): BackupCopyError {
  if (copyError instanceof BackupCopyError) return copyError;
  const code = (copyError as NodeJS.ErrnoException | undefined)?.code;
  const kind = (code && ERROR_KINDS[code]) || "other";
  return new BackupCopyError(kind, KIND_MESSAGES[kind], code);
}

/**
 * The `\\?\` long-path form of a Windows path of 260 characters or more; other paths and other
 * systems are returned unchanged.
 *
 * @example
 * toLongPath("C:\\very\\long\\…", "win32"); // "\\\\?\\C:\\very\\long\\…"
 */
export function toLongPath(absolutePath: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== "win32" || absolutePath.length < WINDOWS_PATH_LIMIT || absolutePath.startsWith("\\\\?\\")) {
    return absolutePath;
  }
  return absolutePath.startsWith("\\\\") ? `\\\\?\\UNC\\${absolutePath.slice(2)}` : `\\\\?\\${absolutePath}`;
}

/**
 * Bytes per second as an exponential moving average, sampled at most every 250 ms, so the speed
 * shown doesn't jump with every chunk.
 *
 * @example
 * const meter = new ThroughputMeter();
 * meter.sample(bytesDone); // after each chunk
 * meter.bytesPerSecond;
 */
export class ThroughputMeter {
  private lastBytes?: number;
  private lastAt = 0;
  private average?: number;

  constructor(private readonly now: () => number = Date.now) {}

  sample(totalBytes: number): void {
    const now = this.now();
    if (this.lastBytes === undefined) {
      this.lastBytes = totalBytes;
      this.lastAt = now;
      return;
    }
    const elapsedMilliseconds = now - this.lastAt;
    if (elapsedMilliseconds < SPEED_SAMPLE_MILLISECONDS) return;
    const rate = ((totalBytes - this.lastBytes) * 1000) / elapsedMilliseconds;
    this.average = this.average === undefined ? rate : SPEED_SMOOTHING * rate + (1 - SPEED_SMOOTHING) * this.average;
    this.lastBytes = totalBytes;
    this.lastAt = now;
  }

  /** Starts over after a pause, so the idle time doesn't count. */
  reset(): void {
    this.lastBytes = undefined;
  }

  get bytesPerSecond(): number | undefined {
    return this.average;
  }
}

/** Test hook: wait this long after each chunk, so tests can watch a copy in progress. */
export function setBackupTestSlowdown(chunkDelayMilliseconds: number): void {
  getGlobalSingleton("backup-test-slowdown", () => ({ chunkDelayMilliseconds: 0 })).chunkDelayMilliseconds =
    chunkDelayMilliseconds;
}

function readTestSlowdown(): number {
  return getGlobalSingleton("backup-test-slowdown", () => ({ chunkDelayMilliseconds: 0 })).chunkDelayMilliseconds;
}

function waitFor(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/** The sha256 of a file, in hex, read in 1 MiB pieces. */
export async function hashFile(
  filePath: string,
  { signal, onBytes }: { signal?: AbortSignal; onBytes?: (byteCount: number) => void } = {},
): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(toLongPath(filePath), { highWaterMark: COPY_CHUNK_BYTES, signal })) {
    hash.update(chunk as Buffer);
    onBytes?.((chunk as Buffer).length);
  }
  return hash.digest("hex");
}

export interface CopyFileOptions {
  /** Read the written file back and compare its sha256 with the source's. */
  verify?: boolean;
  signal?: AbortSignal;
  /** Bytes written, as they are written. */
  onBytes?: (byteCount: number) => void;
  /** Bytes read back while verifying. */
  onVerifyBytes?: (byteCount: number) => void;
  /** Runs between writing and verifying (tests corrupt the file here). */
  beforeVerify?: (partPath: string) => Promise<void>;
}

export interface CopyFileResult {
  bytes: number;
  /** The source's sha256 in hex, when verified. */
  sha256?: string;
  verified: boolean;
}

/**
 * Copies one file for a backup. The source streams to `<dst>.cmm-part` in 1 MiB pieces;
 * with `verify` its sha256 is computed on the way (only then: hashing costs about a third of the
 * speed on a fast SSD), the part is flushed to disk (fsync), read back and compared (a mismatch is
 * read once more before it counts). Then it is renamed over `dst` and given the source's
 * modification time. A failed or cancelled copy removes the part, so `dst` is either
 * the old file or the whole new one.
 *
 * @example
 * await copyFile("/data/notes.md", "/Volumes/USB/notes.md", { verify: true, signal });
 */
export async function copyFile(
  sourcePath: string,
  targetPath: string,
  { verify = false, signal, onBytes, onVerifyBytes, beforeVerify }: CopyFileOptions = {},
): Promise<CopyFileResult> {
  const sourceStats = await stat(toLongPath(sourcePath)).catch((statError: unknown) => {
    throw classifyCopyError(statError);
  });
  const partPath = toLongPath(`${targetPath}${PART_SUFFIX}`);
  const finalPath = toLongPath(targetPath);
  const hash = verify ? createHash("sha256") : undefined;
  let bytes = 0;
  const chunkDelay = readTestSlowdown();
  const hashing = new Transform({
    highWaterMark: COPY_CHUNK_BYTES,
    transform(chunk: Buffer, _encoding, callback) {
      hash?.update(chunk);
      bytes += chunk.length;
      onBytes?.(chunk.length);
      if (chunkDelay > 0) {
        waitFor(chunkDelay, signal).then(
          () => callback(null, chunk),
          (abortError: unknown) => callback(abortError as Error),
        );
        return;
      }
      callback(null, chunk);
    },
  });
  try {
    await pipeline(
      createReadStream(toLongPath(sourcePath), { highWaterMark: COPY_CHUNK_BYTES }),
      hashing,
      createWriteStream(partPath, { highWaterMark: COPY_CHUNK_BYTES, mode: (sourceStats.mode & 0o777) | 0o200 }),
      { signal },
    );
    // A runtime path: the ignore comment keeps Turbopack's file tracer from tracing the whole project.
    // eslint-disable-next-line no-inline-comments
    const handle = await open(/* turbopackIgnore: true */ partPath, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    const sha256 = hash?.digest("hex");
    if (sha256) {
      await beforeVerify?.(partPath);
      let writtenHash = await hashFile(partPath, { signal, onBytes: onVerifyBytes });
      if (writtenHash !== sha256) writtenHash = await hashFile(partPath, { signal });
      if (writtenHash !== sha256) throw new BackupCopyError("verify", KIND_MESSAGES.verify);
    }
    await rename(partPath, finalPath);
    await chmod(finalPath, (sourceStats.mode & 0o7777) | 0o200).catch(() => undefined);
    await utimes(finalPath, sourceStats.atime, sourceStats.mtime);
    return { bytes, sha256, verified: verify };
  } catch (copyError) {
    await rm(partPath, { force: true }).catch(() => undefined);
    if (signal?.aborted) throw copyError;
    throw classifyCopyError(copyError);
  }
}
