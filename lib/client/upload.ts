import type { FileEntry, UploadSession } from "@/lib/api-types";
import { ApiError, requestJson } from "@/lib/client/api";
import { goToSessionPage } from "@/lib/client/session-channel";

export interface UploadTarget {
  storageId: string;
  /** Destination folder, storage-relative. */
  directory: string;
  name: string;
  overwrite: boolean;
}

/** How the uploader talks to the server; tests pass a fake. */
export interface UploadTransport {
  init: (target: UploadTarget, size: number) => Promise<UploadSession>;
  status: (uploadId: string) => Promise<UploadSession>;
  sendChunk: (
    uploadId: string,
    offset: number,
    chunk: Blob,
    onBytesSent: (bytesSent: number) => void,
    signal: AbortSignal,
  ) => Promise<UploadSession>;
  complete: (uploadId: string) => Promise<FileEntry>;
  cancel: (uploadId: string) => Promise<void>;
}

export interface UploadOptions {
  transport?: UploadTransport;
  /** Bytes the server has, including the chunk in flight. */
  onProgress?: (uploadedBytes: number, totalBytes: number) => void;
  signal?: AbortSignal;
  /** Failed chunk attempts in a row before giving up (default 5). */
  maximumAttempts?: number;
  /** Wait before retry `n` (1-based); default 1 s doubling to 16 s. */
  readRetryDelay?: (attempt: number) => number;
}

const DEFAULT_MAXIMUM_ATTEMPTS = 5;

function defaultRetryDelay(attempt: number): number {
  return Math.min(1000 * 2 ** (attempt - 1), 16_000);
}

function waitFor(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("The upload was cancelled.", "AbortError"));
      },
      { once: true },
    );
  });
}

function isRetryable(uploadError: unknown): boolean {
  if (!(uploadError instanceof ApiError)) return true;
  return uploadError.status === 0 || uploadError.status >= 500 || uploadError.code === "UPLOAD_OFFSET_MISMATCH";
}

/**
 * Uploads one file in chunks: `init` (where the `upload` step-up happens, once), then
 * chunks in order. A failed chunk is retried with backoff after asking the server how much it
 * already has, so a dropped connection resumes instead of starting over. Cancelling deletes what
 * arrived.
 *
 * @example
 * const entry = await uploadFile(file, { storageId, directory: "notes", name: file.name, overwrite: false });
 */
export async function uploadFile(
  file: Blob,
  target: UploadTarget,
  {
    transport = xhrUploadTransport,
    onProgress,
    signal,
    maximumAttempts = DEFAULT_MAXIMUM_ATTEMPTS,
    readRetryDelay = defaultRetryDelay,
  }: UploadOptions = {},
): Promise<FileEntry> {
  const session = await transport.init(target, file.size);
  const throwIfCancelled = async () => {
    if (!signal?.aborted) return;
    await transport.cancel(session.uploadId).catch(() => undefined);
    throw new DOMException("The upload was cancelled.", "AbortError");
  };
  let receivedBytes = session.received;
  let failedAttempts = 0;
  onProgress?.(receivedBytes, file.size);
  while (receivedBytes < file.size) {
    await throwIfCancelled();
    const chunkEnd = Math.min(receivedBytes + session.chunkSize, file.size);
    const chunkStart = receivedBytes;
    try {
      const chunkResult = await transport.sendChunk(
        session.uploadId,
        chunkStart,
        file.slice(chunkStart, chunkEnd),
        (bytesSent) => onProgress?.(chunkStart + bytesSent, file.size),
        signal ?? new AbortController().signal,
      );
      receivedBytes = chunkResult.received;
      failedAttempts = 0;
    } catch (chunkError) {
      await throwIfCancelled();
      if (!isRetryable(chunkError)) throw chunkError;
      failedAttempts += 1;
      if (failedAttempts >= maximumAttempts) throw chunkError;
      await waitFor(readRetryDelay(failedAttempts), signal);
      receivedBytes = (await transport.status(session.uploadId)).received;
    }
    onProgress?.(receivedBytes, file.size);
  }
  await throwIfCancelled();
  return transport.complete(session.uploadId);
}

function parseXhrError(request: XMLHttpRequest): ApiError {
  if (request.status === 0) return new ApiError(0, "NETWORK_ERROR", "The connection was interrupted.");
  try {
    const { error } = JSON.parse(request.responseText) as {
      error: { code: string; message: string; details?: Record<string, unknown> };
    };
    return new ApiError(request.status, error.code, error.message, error.details);
  } catch {
    return new ApiError(request.status, "HTTP_ERROR", `The upload failed with status ${request.status}.`);
  }
}

/** Sends one chunk with `XMLHttpRequest`, the only browser API with upload progress events. */
function sendChunkWithXhr(
  uploadId: string,
  offset: number,
  chunk: Blob,
  onBytesSent: (bytesSent: number) => void,
  signal: AbortSignal,
): Promise<UploadSession> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", `/api/fs/upload/${encodeURIComponent(uploadId)}?offset=${offset}`);
    request.setRequestHeader("content-type", "application/octet-stream");
    request.upload.addEventListener("progress", (progressEvent) => onBytesSent(progressEvent.loaded));
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) {
        resolve(JSON.parse(request.responseText) as UploadSession);
        return;
      }
      const apiError = parseXhrError(request);
      if (apiError.code === "SESSION_LOCKED") goToSessionPage("/lock");
      if (apiError.code === "UNAUTHENTICATED") goToSessionPage("/login");
      reject(apiError);
    });
    request.addEventListener("error", () => reject(parseXhrError(request)));
    request.addEventListener("abort", () => reject(new DOMException("The upload was cancelled.", "AbortError")));
    signal.addEventListener("abort", () => request.abort(), { once: true });
    request.send(chunk);
  });
}

/** The real transport: JSON calls through `requestJson` (step-up, session errors) and chunks over XHR. */
export const xhrUploadTransport: UploadTransport = {
  init: (target, size) =>
    requestJson<UploadSession>("/api/fs/upload/init", {
      method: "POST",
      body: {
        storageId: target.storageId,
        dir: target.directory,
        name: target.name,
        size,
        overwrite: target.overwrite,
      },
    }),
  status: (uploadId) => requestJson<UploadSession>(`/api/fs/upload/${encodeURIComponent(uploadId)}`),
  sendChunk: sendChunkWithXhr,
  complete: async (uploadId) =>
    (
      await requestJson<{ entry: FileEntry }>(`/api/fs/upload/${encodeURIComponent(uploadId)}/complete`, {
        method: "POST",
      })
    ).entry,
  cancel: async (uploadId) => {
    await requestJson(`/api/fs/upload/${encodeURIComponent(uploadId)}`, { method: "DELETE" });
  },
};

/**
 * "name (1).ext", "name (2).ext", …: the names the upload queue tries for "Keep both".
 *
 * @example
 * buildKeepBothName("report.md", 1); // "report (1).md"
 */
export function buildKeepBothName(fileName: string, attempt: number): string {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0) return `${fileName} (${attempt})`;
  return `${fileName.slice(0, dotIndex)} (${attempt})${fileName.slice(dotIndex)}`;
}
