/*
 * Parses CSV/TSV off the main thread. Receives `{ text, delimiter, maxRows }`, posts
 * `{ type: "progress", parsedRows }` while it works and `{ type: "done", result }` at the end.
 */
import { parseCsv, type CsvParseOptions } from "@/lib/csv/parse-csv";

interface CsvParseRequest {
  text: string;
  delimiter?: CsvParseOptions["delimiter"];
  maxRows: number;
}

const workerScope = globalThis as unknown as {
  onmessage: ((messageEvent: MessageEvent<CsvParseRequest>) => void) | null;
  postMessage: (message: unknown) => void;
};

workerScope.onmessage = ({ data: { text, delimiter, maxRows } }) => {
  try {
    const result = parseCsv(text, {
      delimiter,
      maxRows,
      onProgress: (parsedRows) => workerScope.postMessage({ type: "progress", parsedRows }),
    });
    workerScope.postMessage({ type: "done", result });
  } catch (parseError) {
    workerScope.postMessage({
      type: "error",
      message: parseError instanceof Error ? parseError.message : "Parsing failed.",
    });
  }
};
