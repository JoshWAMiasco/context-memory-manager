/*
 * Reads an xlsx file off the main thread. Receives `{ buffer, maxRows }`, posts
 * `{ type: "done", sheets }` (every sheet, as text rows) or `{ type: "error", message }`.
 */
import readXlsxFile from "read-excel-file/web-worker";
import { toSheetTable, type SheetCell } from "@/lib/spreadsheet/sheet-rows";

interface XlsxParseRequest {
  buffer: ArrayBuffer;
  maxRows: number;
}

const workerScope = globalThis as unknown as {
  onmessage: ((messageEvent: MessageEvent<XlsxParseRequest>) => void) | null;
  postMessage: (message: unknown) => void;
};

workerScope.onmessage = ({ data: { buffer, maxRows } }) => {
  readXlsxFile(buffer).then(
    (sheets) =>
      workerScope.postMessage({
        type: "done",
        sheets: sheets.map(({ sheet, data }) =>
          toSheetTable(sheet, data as unknown as readonly (readonly SheetCell[])[], maxRows),
        ),
      }),
    (parseError: unknown) =>
      workerScope.postMessage({
        type: "error",
        message:
          parseError instanceof Error ? `This spreadsheet can't be read: ${parseError.message}` : "Reading failed.",
      }),
  );
};
