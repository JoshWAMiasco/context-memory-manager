"use client";

import { Info } from "lucide-react";
import { useEffect, useState } from "react";
import { ContentError, ContentLoader } from "@/components/viewer/content-loader";
import { CsvTable } from "@/components/viewer/csv-table";
import type { FileEntry } from "@/lib/api-types";
import { fetchBytes } from "@/lib/client/fs";
import { parseXlsxInWorker } from "@/lib/client/xlsx-worker";
import type { SheetTable } from "@/lib/spreadsheet/sheet-rows";
import { mergeClassNames } from "@/utilities/merge-class-names";

/**
 * An Excel workbook (xlsx) as tables: the file is read in a web worker in the browser (nothing is
 * sent anywhere), each sheet is a tab, and a sheet shows in the CSV table (sorting, filters,
 * search). Cells show their saved values; formulas aren't recalculated. Sheets stop after
 * `maxRows` rows (the `viewer.csvMaxRows` setting) and say so.
 *
 * @example
 * <SpreadsheetViewer entry={entry} source={rawUrl} maxRows={50_000} onDownload={download} />
 */
export function SpreadsheetViewer({
  entry,
  source,
  maxRows,
  onDownload,
}: {
  entry: FileEntry;
  source: string;
  maxRows: number;
  onDownload: () => void;
}) {
  const [loaded, setLoaded] = useState<{ source: string; sheets: SheetTable[] }>();
  const [loadError, setLoadError] = useState<unknown>();
  const [attempt, setAttempt] = useState(0);
  const [activeSheet, setActiveSheet] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchBytes(source, controller.signal)
      .then((buffer) => parseXlsxInWorker(buffer, maxRows + 1, controller.signal))
      .then(
        (sheets) => {
          setLoadError(undefined);
          setLoaded({ source, sheets });
        },
        (error: unknown) => {
          if (!controller.signal.aborted) setLoadError(error);
        },
      );
    return () => controller.abort();
  }, [attempt, maxRows, source]);

  if (loadError) {
    return (
      <ContentError
        error={loadError}
        onDownload={onDownload}
        onRetry={() => {
          setLoadError(undefined);
          setAttempt(attempt + 1);
        }}
      />
    );
  }
  if (loaded?.source !== source) return <ContentLoader entry={entry} variant="table" label="Reading the workbook…" />;
  const { sheets } = loaded;
  if (sheets.length === 0) return <p className="p-5 text-sm text-foreground-muted">This workbook has no sheets.</p>;
  const sheet = sheets[Math.min(activeSheet, sheets.length - 1)] ?? sheets[0];
  if (!sheet) return null;
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="spreadsheet-viewer">
      <div className="min-h-0 flex-1">
        {sheet.rows.length === 0 ? (
          <p className="p-5 text-sm text-foreground-muted" data-testid="sheet-empty">
            This sheet is empty.
          </p>
        ) : (
          <CsvTable
            key={`${sheet.name}:${activeSheet}`}
            rows={sheet.rows}
            columnCount={sheet.columnCount}
            notice={
              sheet.isTruncated && (
                <span className="flex items-center gap-1 text-warning" data-testid="sheet-truncated-notice">
                  <Info className="h-3.5 w-3.5" aria-hidden />
                  Showing first {(sheet.rows.length - 1).toLocaleString()} of {sheet.totalRows.toLocaleString()} rows
                </span>
              )
            }
          />
        )}
      </div>
      <div
        role="tablist"
        aria-label="Sheets"
        className="flex flex-none gap-0.5 overflow-x-auto border-t border-line/60 bg-surface-subtle px-2 py-1"
      >
        {sheets.map((candidate, sheetIndex) => (
          <button
            key={`${candidate.name}:${sheetIndex}`}
            type="button"
            role="tab"
            aria-selected={candidate === sheet}
            onClick={() => setActiveSheet(sheetIndex)}
            data-testid="sheet-tab"
            className={mergeClassNames(
              "cursor-pointer rounded-md px-3 py-1 text-xs whitespace-nowrap",
              candidate === sheet
                ? "bg-surface-strong font-medium text-brand"
                : "text-foreground-muted hover:bg-surface-muted",
            )}
          >
            {candidate.name}
          </button>
        ))}
      </div>
    </div>
  );
}
