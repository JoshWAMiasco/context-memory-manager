import type { SheetTable } from "@/lib/spreadsheet/sheet-rows";

type XlsxWorkerMessage = { type: "done"; sheets: SheetTable[] } | { type: "error"; message: string };

/**
 * Reads every sheet of an xlsx file in a web worker, so a big workbook never blocks the page.
 * Aborting the signal stops the worker.
 *
 * @example
 * const sheets = await parseXlsxInWorker(buffer, 50_000, signal);
 */
export function parseXlsxInWorker(buffer: ArrayBuffer, maxRows: number, signal?: AbortSignal): Promise<SheetTable[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/xlsx-parse.worker.ts", import.meta.url), { type: "module" });
    const stop = () => {
      worker.terminate();
      reject(new DOMException("Reading the spreadsheet was cancelled.", "AbortError"));
    };
    signal?.addEventListener("abort", stop, { once: true });
    worker.addEventListener("message", ({ data: message }: MessageEvent<XlsxWorkerMessage>) => {
      signal?.removeEventListener("abort", stop);
      worker.terminate();
      if (message.type === "done") resolve(message.sheets);
      else reject(new Error(message.message));
    });
    worker.addEventListener("error", (errorEvent) => {
      signal?.removeEventListener("abort", stop);
      worker.terminate();
      reject(new Error(errorEvent.message || "The spreadsheet reader stopped."));
    });
    worker.postMessage({ buffer, maxRows }, [buffer]);
  });
}
