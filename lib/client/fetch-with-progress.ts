import { ApiError, handleSessionError, toApiError } from "@/lib/client/api";

export interface TransferProgress {
  loaded: number;
  /** From `Content-Length`, or the size the caller expected; undefined when unknown. */
  total?: number;
}

export interface FetchWithProgressOptions {
  signal?: AbortSignal;
  onProgress?: (progress: TransferProgress) => void;
  /** Used as the total when the response has no `Content-Length` (JSON, transformed content). */
  expectedBytes?: number;
}

async function readErrorBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/**
 * Downloads a response body chunk by chunk through `response.body.getReader()`, reporting
 * `{ loaded, total }` as it goes. Aborting `signal` cancels the request. A non-2xx response
 * throws an `ApiError` (session errors are handled as in `requestJson`). Resolves with the bytes
 * and the response's ETag.
 *
 * @example
 * const { bytes } = await fetchWithProgress(`/api/fs/raw?${query}`, { signal, onProgress: setProgress });
 */
export async function fetchWithProgress(
  url: string,
  { signal, onProgress, expectedBytes }: FetchWithProgressOptions = {},
): Promise<{ bytes: Uint8Array; etag?: string }> {
  let response: Response;
  try {
    response = await fetch(url, { credentials: "same-origin", signal });
  } catch (networkError) {
    if (networkError instanceof DOMException && networkError.name === "AbortError") throw networkError;
    throw new ApiError(0, "NETWORK_ERROR", "The CCM server could not be reached.");
  }
  if (!response.ok) {
    const apiError = toApiError(response.status, await readErrorBody(response));
    handleSessionError(apiError);
    throw apiError;
  }
  const etag = response.headers.get("etag") ?? undefined;
  const contentLength = Number(response.headers.get("content-length"));
  const total = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : expectedBytes;
  if (!response.body) {
    const wholeBody = new Uint8Array(await response.arrayBuffer());
    onProgress?.({ loaded: wholeBody.byteLength, total: total ?? wholeBody.byteLength });
    return { bytes: wholeBody, etag };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  onProgress?.({ loaded, total });
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress?.({ loaded, total: total === undefined ? undefined : Math.max(total, loaded) });
  }
  const body = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes: body, etag };
}

export interface SendJsonOptions {
  method: "PUT" | "POST";
  body: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  onUploadProgress?: (progress: TransferProgress) => void;
}

/**
 * Sends a JSON body with `XMLHttpRequest`, the one browser API that reports upload progress
 * (large saves). Resolves with the parsed JSON response; failures throw `ApiError`.
 *
 * @example
 * const fileStat = await sendJsonWithProgress<FileStat>("/api/fs/text", { method: "PUT", body, onUploadProgress });
 */
export function sendJsonWithProgress<ResponseBody>(
  url: string,
  { method, body, headers = {}, signal, onUploadProgress }: SendJsonOptions,
): Promise<ResponseBody> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(method, url);
    request.withCredentials = true;
    request.setRequestHeader("content-type", "application/json");
    request.setRequestHeader("accept", "application/json");
    for (const [headerName, headerValue] of Object.entries(headers)) request.setRequestHeader(headerName, headerValue);
    request.upload.addEventListener("progress", (progressEvent) =>
      onUploadProgress?.({
        loaded: progressEvent.loaded,
        total: progressEvent.lengthComputable ? progressEvent.total : undefined,
      }),
    );
    request.addEventListener("load", () => {
      let responseBody: unknown;
      try {
        responseBody = request.responseText === "" ? undefined : JSON.parse(request.responseText);
      } catch {
        responseBody = undefined;
      }
      if (request.status >= 200 && request.status < 300) {
        resolve(responseBody as ResponseBody);
        return;
      }
      const apiError = toApiError(request.status, responseBody);
      handleSessionError(apiError);
      reject(apiError);
    });
    request.addEventListener("error", () =>
      reject(new ApiError(0, "NETWORK_ERROR", "The CCM server could not be reached.")),
    );
    request.addEventListener("abort", () => reject(new DOMException("The save was cancelled.", "AbortError")));
    signal?.addEventListener("abort", () => request.abort(), { once: true });
    request.send(JSON.stringify(body));
  });
}
