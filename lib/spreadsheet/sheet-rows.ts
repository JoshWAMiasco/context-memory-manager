/*
 * Turns the cells read from an xlsx file into the text rows the table shows. Isomorphic: used by
 * the spreadsheet worker and by tests.
 */

/** A cell as read-excel-file gives it. */
export type SheetCell = string | number | boolean | Date | null | undefined;

/** One sheet, ready for the table. */
export interface SheetTable {
  name: string;
  rows: string[][];
  /** The widest row: short rows are shown with empty cells. */
  columnCount: number;
  /** True when only the first `maxRows` rows are kept. */
  isTruncated: boolean;
  totalRows: number;
}

function formatDate(date: Date): string {
  const isoText = date.toISOString();
  // Excel dates have no time zone; one at midnight is a plain date.
  return isoText.endsWith("T00:00:00.000Z") ? isoText.slice(0, 10) : isoText.slice(0, 19).replace("T", " ");
}

/**
 * A cell's text: numbers as they are, dates as `2024-03-01` (or with a time), booleans as
 * TRUE/FALSE like Excel, empty cells as "".
 *
 * @example
 * formatSheetCell(new Date(Date.UTC(2024, 2, 1))); // "2024-03-01"
 */
export function formatSheetCell(cell: SheetCell): string {
  if (cell === null || cell === undefined) return "";
  if (cell instanceof Date) return Number.isNaN(cell.getTime()) ? "" : formatDate(cell);
  if (typeof cell === "boolean") return cell ? "TRUE" : "FALSE";
  return String(cell);
}

/**
 * A sheet's rows as text, at most `maxRows` of them, with trailing empty rows left out.
 *
 * @example
 * toSheetTable("Budget", [["Item", "Cost"], ["Rent", 1200]], 50_000);
 */
export function toSheetTable(name: string, data: readonly (readonly SheetCell[])[], maxRows: number): SheetTable {
  let lastFilledRow = data.length;
  while (lastFilledRow > 0 && (data[lastFilledRow - 1] ?? []).every((cell) => formatSheetCell(cell) === "")) {
    lastFilledRow -= 1;
  }
  const kept = data.slice(0, Math.min(lastFilledRow, maxRows));
  const rows = kept.map((row) => row.map((cell) => formatSheetCell(cell)));
  return {
    name,
    rows,
    columnCount: rows.reduce((widest, row) => Math.max(widest, row.length), 0),
    isTruncated: lastFilledRow > maxRows,
    totalRows: lastFilledRow,
  };
}
