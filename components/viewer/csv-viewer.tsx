"use client";

import { Info } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ContentError, ContentLoader } from "@/components/viewer/content-loader";
import { CsvTable } from "@/components/viewer/csv-table";
import type { FileEntry } from "@/lib/api-types";
import { parseCsvInWorker } from "@/lib/client/csv-worker";
import { readForcedDelimiter, type CsvParseResult } from "@/lib/csv/parse-csv";

/** Counts line breaks up to `limit`, for the parsing progress bar. */
function countLines(text: string, limit: number): number {
  let lineCount = 1;
  for (let index = text.indexOf("\n"); index !== -1 && lineCount < limit; index = text.indexOf("\n", index + 1)) {
    lineCount += 1;
  }
  return lineCount;
}

/**
 * CSV and TSV as a table: parses the text in a web worker (showing the row count as it
 * goes), stops after `maxRows` data rows (the `viewer.csvMaxRows` setting) and says so, then shows
 * `CsvTable`.
 *
 * @example
 * <CsvViewer content={text} entry={entry} maxRows={50_000} />
 */
export function CsvViewer({ content, entry, maxRows }: { content: string; entry: FileEntry; maxRows: number }) {
  const [parseResult, setParseResult] = useState<CsvParseResult>();
  const [parsedRows, setParsedRows] = useState(0);
  const [parseError, setParseError] = useState<unknown>();
  const [attempt, setAttempt] = useState(0);
  const [parsedContent, setParsedContent] = useState(content);

  const expectedRows = useMemo(() => countLines(content, maxRows + 1), [content, maxRows]);

  if (parsedContent !== content) {
    setParsedContent(content);
    setParseResult(undefined);
    setParsedRows(0);
  }

  useEffect(() => {
    const controller = new AbortController();
    parseCsvInWorker(
      content,
      { delimiter: readForcedDelimiter(entry.name), maxRows: maxRows + 1, onProgress: setParsedRows },
      controller.signal,
    ).then(
      (result) => {
        setParseError(undefined);
        setParseResult(result);
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setParseError(error);
      },
    );
    return () => controller.abort();
  }, [attempt, content, entry.name, maxRows]);

  if (parseError) {
    return (
      <ContentError
        error={parseError}
        onRetry={() => {
          setParseError(undefined);
          setAttempt(attempt + 1);
        }}
      />
    );
  }
  if (!parseResult) {
    return (
      <ContentLoader
        entry={entry}
        variant="table"
        label={parsedRows > 0 ? `Reading rows… ${parsedRows.toLocaleString()}` : "Reading rows…"}
        progress={{ loaded: Math.min(parsedRows, expectedRows), total: expectedRows }}
      />
    );
  }
  const dataRowCount = Math.max(0, parseResult.rows.length - 1);
  return (
    <CsvTable
      rows={parseResult.rows}
      columnCount={parseResult.columnCount}
      notice={
        parseResult.isTruncated && (
          <span className="flex items-center gap-1 text-warning" data-testid="csv-truncated-notice">
            <Info className="h-3.5 w-3.5" aria-hidden />
            Showing first {dataRowCount.toLocaleString()} of ≈
            {Math.max(dataRowCount, parseResult.estimatedTotalRows - 1).toLocaleString()} rows
          </span>
        )
      }
    />
  );
}
