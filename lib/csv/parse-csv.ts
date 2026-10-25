/*
 * CSV and TSV parsing for the table viewer. Pure and isomorphic: the worker in
 * lib/workers/csv-parse.worker.ts runs it off the main thread.
 */
import Papa from "papaparse";

export type CsvDelimiter = "," | ";" | "\t" | "|";

export interface CsvParseOptions {
  /** Set for `.tsv` files; otherwise the delimiter is detected from `,`, `;`, tab and `|`. */
  delimiter?: CsvDelimiter;
  /** Parsing stops after this many rows (the header row counts). */
  maxRows: number;
  /** Called every few thousand rows with the number parsed so far. */
  onProgress?: (parsedRows: number) => void;
}

export interface CsvParseResult {
  rows: string[][];
  delimiter: string;
  /** The widest row: short rows are shown with empty cells. */
  columnCount: number;
  /** True when parsing stopped at `maxRows`. */
  isTruncated: boolean;
  /** The total row count; an estimate from the bytes read when truncated. */
  estimatedTotalRows: number;
}

const PROGRESS_INTERVAL_ROWS = 5000;
const DELIMITERS_TO_GUESS: CsvDelimiter[] = [",", ";", "\t", "|"];

/**
 * Parses delimited text into rows of strings. Strips a byte order mark, keeps line breaks inside
 * quoted fields, skips blank lines, and stops at `maxRows`.
 *
 * @example
 * parseCsv("name,size\na.md,12\n", { maxRows: 50_000 }).rows; // [["name", "size"], ["a.md", "12"]]
 */
export function parseCsv(text: string, { delimiter, maxRows, onProgress }: CsvParseOptions): CsvParseResult {
  const content = text.startsWith("﻿") ? text.slice(1) : text;
  const rows: string[][] = [];
  let columnCount = 0;
  let isTruncated = false;
  let stoppedAtCharacter = content.length;
  let detectedDelimiter: string = delimiter ?? ",";
  Papa.parse<string[]>(content, {
    delimiter: delimiter ?? "",
    delimitersToGuess: DELIMITERS_TO_GUESS,
    skipEmptyLines: true,
    step: (stepResult, parser) => {
      if (rows.length >= maxRows) {
        isTruncated = true;
        stoppedAtCharacter = stepResult.meta.cursor;
        parser.abort();
        return;
      }
      detectedDelimiter = stepResult.meta.delimiter;
      rows.push(stepResult.data);
      columnCount = Math.max(columnCount, stepResult.data.length);
      if (rows.length % PROGRESS_INTERVAL_ROWS === 0) onProgress?.(rows.length);
    },
  });
  const estimatedTotalRows =
    isTruncated && stoppedAtCharacter > 0
      ? Math.max(rows.length + 1, Math.round((rows.length * content.length) / stoppedAtCharacter))
      : rows.length;
  return { rows, delimiter: detectedDelimiter, columnCount, isTruncated, estimatedTotalRows };
}

export type CsvColumnType = "number" | "date" | "text";

const NUMBER_PATTERN = /^[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?(?:[eE][-+]?\d+)?%?$/;
const DATE_PATTERN =
  /^(?:\d{4}-\d{1,2}-\d{1,2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})$/;
const TYPE_SAMPLE_ROWS = 200;

/** A cell as a number for sorting: "1,234.5" → 1234.5, "12%" → 12; NaN when it isn't one. */
export function readCellNumber(cell: string): number {
  const trimmedCell = cell.trim();
  if (trimmedCell === "" || !NUMBER_PATTERN.test(trimmedCell) || !/\d/.test(trimmedCell)) return Number.NaN;
  return Number(trimmedCell.replaceAll(",", "").replace(/%$/, ""));
}

/** A cell as a timestamp for sorting; NaN when it isn't a date. */
export function readCellDate(cell: string): number {
  const trimmedCell = cell.trim();
  return DATE_PATTERN.test(trimmedCell) ? Date.parse(trimmedCell.replace(/^(\d{4}-\d{2}-\d{2}) /, "$1T")) : Number.NaN;
}

/**
 * Guesses each column's type from up to 200 data rows: a column whose non-empty cells are all
 * numbers is "number", all dates is "date", anything else "text".
 *
 * @example
 * inferColumnTypes([["1", "2024-01-02", "x"]], 3); // ["number", "date", "text"]
 */
export function inferColumnTypes(dataRows: readonly (readonly string[])[], columnCount: number): CsvColumnType[] {
  const sampleRows = dataRows.slice(0, TYPE_SAMPLE_ROWS);
  return Array.from({ length: columnCount }, (_unused, columnIndex) => {
    const cells = sampleRows.map((row) => (row[columnIndex] ?? "").trim()).filter((cell) => cell !== "");
    if (cells.length === 0) return "text";
    if (cells.every((cell) => !Number.isNaN(readCellNumber(cell)))) return "number";
    if (cells.every((cell) => !Number.isNaN(readCellDate(cell)))) return "date";
    return "text";
  });
}

/** The delimiter to force for a file name: tab for `.tsv` and `.tab`, otherwise detect. */
export function readForcedDelimiter(fileName: string): CsvDelimiter | undefined {
  return /\.(tsv|tab)$/i.test(fileName) ? "\t" : undefined;
}
