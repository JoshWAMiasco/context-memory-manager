/*
 * The desktop app's log files: `userData/logs/main.log` for the main process and
 * `server.log` for the CCM server's stdout and stderr. Each rotates at 5 MB and keeps 3 old files
 * (`main.log.1` newest … `main.log.3` oldest). Writes are synchronous so the last lines before a
 * crash are on disk.
 */
import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";

export const LOG_MAX_BYTES = 5 * 1024 * 1024;
export const LOG_KEEP_FILES = 3;

export interface RotatingLogOptions {
  maxBytes?: number;
  keepFiles?: number;
}

/**
 * One log line: an ISO timestamp, the source in brackets, the text without its trailing newline.
 *
 * @example
 * formatLogLine("main", "window opened", new Date(0)); // "1970-01-01T00:00:00.000Z [main] window opened\n"
 */
export function formatLogLine(source: string, text: string, now = new Date()): string {
  return `${now.toISOString()} [${source}] ${text.replace(/\s+$/, "")}\n`;
}

/** An append-only log file that rotates itself by size. */
export class RotatingLogFile {
  readonly filePath: string;
  private readonly maxBytes: number;
  private readonly keepFiles: number;
  private currentBytes: number;

  /**
   * @example
   * const serverLog = new RotatingLogFile(path.join(logsDirectory, "server.log"));
   * serverLog.write(formatLogLine("server", "listening"));
   */
  constructor(filePath: string, { maxBytes = LOG_MAX_BYTES, keepFiles = LOG_KEEP_FILES }: RotatingLogOptions = {}) {
    this.filePath = filePath;
    this.maxBytes = maxBytes;
    this.keepFiles = keepFiles;
    mkdirSync(path.dirname(filePath), { recursive: true });
    this.currentBytes = existsSync(filePath) ? statSync(filePath).size : 0;
  }

  /** Appends text, rotating first when it would push the file past the limit. Never throws. */
  write(text: string): void {
    const byteCount = Buffer.byteLength(text);
    try {
      if (this.currentBytes > 0 && this.currentBytes + byteCount > this.maxBytes) this.rotate();
      appendFileSync(this.filePath, text);
      this.currentBytes += byteCount;
    } catch {
      /* A full or read-only disk must not take the app down with it; the line is lost. */
    }
  }

  private rotate(): void {
    rmSync(`${this.filePath}.${this.keepFiles}`, { force: true });
    for (let generation = this.keepFiles - 1; generation >= 1; generation -= 1) {
      const olderPath = `${this.filePath}.${generation}`;
      if (existsSync(olderPath)) renameSync(olderPath, `${this.filePath}.${generation + 1}`);
    }
    renameSync(this.filePath, `${this.filePath}.1`);
    this.currentBytes = 0;
  }
}
