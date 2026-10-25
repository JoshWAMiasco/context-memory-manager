import { parseCsv, type CsvParseOptions, type CsvParseResult } from "@/lib/csv/parse-csv";

type CsvWorkerMessage =
  | { type: "progress"; parsedRows: number }
  | { type: "done"; result: CsvParseResult }
  | { type: "error"; message: string };

/**
 * Parses CSV text in a web worker, so a 100,000-row file never blocks the page. Aborting the
 * signal stops the worker. Falls back to the main thread where workers are unavailable.
 *
 * @example
 * const result = await parseCsvInWorker(text, { maxRows: 50_000, onProgress: setParsedRows }, signal);
 */
export function parseCsvInWorker(
  text: string,
  { delimiter, maxRows, onProgress }: CsvParseOptions,
  signal?: AbortSignal,
): Promise<CsvParseResult> {
  if (typeof Worker === "undefined") return Promise.resolve(parseCsv(text, { delimiter, maxRows, onProgress }));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/csv-parse.worker.ts", import.meta.url), { type: "module" });
    const stop = () => {
      worker.terminate();
      reject(new DOMException("CSV parsing was cancelled.", "AbortError"));
    };
    signal?.addEventListener("abort", stop, { once: true });
    worker.addEventListener("message", ({ data: message }: MessageEvent<CsvWorkerMessage>) => {
      if (message.type === "progress") {
        onProgress?.(message.parsedRows);
        return;
      }
      signal?.removeEventListener("abort", stop);
      worker.terminate();
      if (message.type === "done") resolve(message.result);
      else reject(new Error(message.message));
    });
    worker.addEventListener("error", (errorEvent) => {
      signal?.removeEventListener("abort", stop);
      worker.terminate();
      reject(new Error(errorEvent.message || "The CSV parser stopped."));
    });
    worker.postMessage({ text, delimiter, maxRows });
  });
}
