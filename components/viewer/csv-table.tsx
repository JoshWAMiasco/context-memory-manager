"use client";

import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type ColumnSizingState,
  type FilterFn,
  type SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ChevronsUpDown, Copy, Search } from "lucide-react";
import { useDeferredValue, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { announce } from "@/components/explorer/explorer-context";
import { FormCheckbox } from "@/components/primitives/form-check";
import { inferColumnTypes, readCellDate, readCellNumber, type CsvColumnType } from "@/lib/csv/parse-csv";
import { mergeClassNames } from "@/utilities/merge-class-names";

interface CsvRow {
  /** The row's position in the data rows, which never changes with sorting or filtering. */
  index: number;
  cells: readonly string[];
}

interface CellPosition {
  rowIndex: number;
  columnIndex?: number;
}

const ROW_HEIGHT = 28;
const ROW_NUMBER_WIDTH = 64;
const DEFAULT_COLUMN_WIDTH = 160;
const MINIMUM_COLUMN_WIDTH = 60;
const MAXIMUM_AUTO_FIT_WIDTH = 600;

const TYPE_LABELS: Record<CsvColumnType, string> = { number: "123", date: "date", text: "abc" };

/** Highlights every case-insensitive occurrence of `query` in `text`. */
function highlightMatches(text: string, query: string): ReactNode {
  if (query === "") return text;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const parts: ReactNode[] = [];
  let startIndex = 0;
  for (
    let matchIndex = lowerText.indexOf(lowerQuery);
    matchIndex !== -1;
    matchIndex = lowerText.indexOf(lowerQuery, startIndex)
  ) {
    parts.push(text.slice(startIndex, matchIndex));
    parts.push(
      <mark key={matchIndex} className="rounded-xs bg-warning/40 text-foreground-strong">
        {text.slice(matchIndex, matchIndex + query.length)}
      </mark>,
    );
    startIndex = matchIndex + query.length;
  }
  parts.push(text.slice(startIndex));
  return parts;
}

const COMPARISON_PATTERN = /^(>=|<=|>|<|=)\s*(.+)$/;

/** Column filter: text contains, or `>10`, `<=2024-01-01`… on number and date columns. */
function createColumnFilter(columnType: CsvColumnType): FilterFn<CsvRow> {
  return (row, columnId, filterValue: string) => {
    const cell = String(row.getValue(columnId) ?? "");
    const comparison = columnType === "text" ? null : COMPARISON_PATTERN.exec(filterValue.trim());
    if (comparison?.[1] && comparison[2]) {
      const readValue = columnType === "number" ? readCellNumber : readCellDate;
      const cellValue = readValue(cell);
      const targetValue = readValue(comparison[2]);
      if (Number.isNaN(cellValue) || Number.isNaN(targetValue)) return false;
      if (comparison[1] === ">") return cellValue > targetValue;
      if (comparison[1] === "<") return cellValue < targetValue;
      if (comparison[1] === ">=") return cellValue >= targetValue;
      if (comparison[1] === "<=") return cellValue <= targetValue;
      return cellValue === targetValue;
    }
    return cell.toLowerCase().includes(filterValue.toLowerCase());
  };
}

let measuringContext: CanvasRenderingContext2D | null | undefined;

/** The width a column needs for its header and the given cells, from canvas text measurement. */
function measureColumnWidth(header: string, cells: readonly string[], fontSource: Element | null): number {
  measuringContext ??= document.createElement("canvas").getContext("2d");
  if (!measuringContext) return DEFAULT_COLUMN_WIDTH;
  measuringContext.font = fontSource ? getComputedStyle(fontSource).font : "12px monospace";
  const widest = Math.max(
    measuringContext.measureText(header).width + 40,
    ...cells.map((cell) => measuringContext?.measureText(cell).width ?? 0),
  );
  return Math.min(MAXIMUM_AUTO_FIT_WIDTH, Math.max(MINIMUM_COLUMN_WIDTH, Math.ceil(widest + 20)));
}

/**
 * The CSV/TSV table: virtualised rows, sticky header and row numbers, sorting by the
 * column's inferred type (number, date or text), per-column filters (`>10` works on numbers and
 * dates), a global search with highlighting, resizable columns (double-click a divider to fit),
 * copying a cell or a row as TSV, and a "First row is header" switch.
 *
 * @example
 * <CsvTable rows={result.rows} columnCount={result.columnCount} />
 */
export function CsvTable({
  rows,
  columnCount,
  notice,
}: {
  rows: readonly string[][];
  columnCount: number;
  notice?: ReactNode;
}) {
  const [isFirstRowHeader, setIsFirstRowHeader] = useState(true);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [searchInput, setSearchInput] = useState("");
  const globalFilter = useDeferredValue(searchInput);
  const [selectedCell, setSelectedCell] = useState<CellPosition>();
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);

  const headerCells = useMemo<readonly string[]>(
    () => (isFirstRowHeader ? (rows[0] ?? []) : []),
    [isFirstRowHeader, rows],
  );
  const dataRows = useMemo<CsvRow[]>(
    () => rows.slice(isFirstRowHeader ? 1 : 0).map((cells, index) => ({ index, cells })),
    [isFirstRowHeader, rows],
  );
  const columnTypes = useMemo(
    () =>
      inferColumnTypes(
        dataRows.map((row) => row.cells),
        columnCount,
      ),
    [columnCount, dataRows],
  );
  const sortValues = useMemo(
    () =>
      columnTypes.map((columnType, columnIndex) => {
        if (columnType === "text") return undefined;
        const readValue = columnType === "number" ? readCellNumber : readCellDate;
        return Float64Array.from(dataRows, (row) => readValue(row.cells[columnIndex] ?? ""));
      }),
    [columnTypes, dataRows],
  );

  const columns = useMemo<ColumnDef<CsvRow, string>[]>(
    () =>
      Array.from({ length: columnCount }, (_unused, columnIndex) => {
        const columnType = columnTypes[columnIndex] ?? "text";
        const columnSortValues = sortValues[columnIndex];
        return {
          id: String(columnIndex),
          header: headerCells[columnIndex]?.trim() || `Column ${columnIndex + 1}`,
          accessorFn: (row: CsvRow) => row.cells[columnIndex] ?? "",
          size: DEFAULT_COLUMN_WIDTH,
          minSize: MINIMUM_COLUMN_WIDTH,
          meta: { columnType },
          filterFn: createColumnFilter(columnType),
          sortingFn: columnSortValues
            ? (firstRow, secondRow) => {
                const firstValue = columnSortValues[firstRow.original.index] ?? Number.NaN;
                const secondValue = columnSortValues[secondRow.original.index] ?? Number.NaN;
                if (Number.isNaN(firstValue)) return Number.isNaN(secondValue) ? 0 : 1;
                if (Number.isNaN(secondValue)) return -1;
                return firstValue - secondValue;
              }
            : (firstRow, secondRow) =>
                String(firstRow.getValue(String(columnIndex))).localeCompare(
                  String(secondRow.getValue(String(columnIndex))),
                  undefined,
                  { numeric: true, sensitivity: "base" },
                ),
        } satisfies ColumnDef<CsvRow, string>;
      }),
    [columnCount, columnTypes, headerCells, sortValues],
  );

  const table = useReactTable({
    data: dataRows,
    columns,
    state: { sorting, columnFilters, columnSizing, globalFilter },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnSizingChange: setColumnSizing,
    globalFilterFn: "includesString",
    columnResizeMode: "onChange",
    enableColumnResizing: true,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const visibleRows = table.getRowModel().rows;
  const rowVirtualizer = useVirtualizer({
    count: visibleRows.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });
  const totalWidth = ROW_NUMBER_WIDTH + table.getTotalSize();
  const leafColumns = table.getVisibleLeafColumns();

  const copyText = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      announce(`Copied ${what}`);
    } catch {
      announce("Copying isn't allowed here");
    }
  };

  const readSelectedRow = (position: CellPosition) => dataRows[position.rowIndex];
  const copySelection = (scope: "cell" | "row") => {
    if (!selectedCell) return;
    const row = readSelectedRow(selectedCell);
    if (!row) return;
    if (scope === "cell" && selectedCell.columnIndex !== undefined) {
      void copyText(row.cells[selectedCell.columnIndex] ?? "", "cell");
    } else {
      void copyText(row.cells.join("\t"), "row");
    }
  };

  const handleKeyDown = (keyEvent: KeyboardEvent<HTMLDivElement>) => {
    if ((keyEvent.metaKey || keyEvent.ctrlKey) && keyEvent.key.toLowerCase() === "c" && selectedCell) {
      if (window.getSelection()?.toString()) return;
      keyEvent.preventDefault();
      copySelection(selectedCell.columnIndex === undefined || keyEvent.shiftKey ? "row" : "cell");
    }
  };

  const autoFitColumn = (columnIndex: number) => {
    const visibleCells = rowVirtualizer
      .getVirtualItems()
      .map((virtualRow) => visibleRows[virtualRow.index]?.original.cells[columnIndex] ?? "");
    const header = String(leafColumns[columnIndex]?.columnDef.header ?? "");
    const width = measureColumnWidth(header, visibleCells, scrollElement?.querySelector("[data-csv-cell]") ?? null);
    setColumnSizing((previousSizing) => ({ ...previousSizing, [String(columnIndex)]: width }));
  };

  const filteredCount = visibleRows.length;
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="csv-viewer">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line/60 bg-surface-subtle px-3 py-2 text-xs">
        <label className="relative flex items-center">
          <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-foreground-subtle" aria-hidden />
          <input
            type="search"
            value={searchInput}
            onChange={(changeEvent) => setSearchInput(changeEvent.target.value)}
            placeholder="Search all columns"
            aria-label="Search all columns"
            data-testid="csv-search"
            className="h-7 w-52 rounded-md border-line-strong bg-field py-0 pr-2 pl-7 text-xs"
          />
        </label>
        <FormCheckbox
          id="csv-first-row-header"
          label="First row is header"
          checked={isFirstRowHeader}
          onChange={(changeEvent) => {
            setIsFirstRowHeader(changeEvent.target.checked);
            setSelectedCell(undefined);
            setSorting([]);
            setColumnFilters([]);
          }}
        />
        <span className="text-foreground-subtle" data-testid="csv-counts">
          {filteredCount === dataRows.length
            ? `${dataRows.length.toLocaleString()} rows`
            : `${filteredCount.toLocaleString()} of ${dataRows.length.toLocaleString()} rows`}{" "}
          × {columnCount.toLocaleString()} columns
        </span>
        {notice}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            disabled={selectedCell?.columnIndex === undefined}
            onClick={() => copySelection("cell")}
            className="flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-foreground-muted hover:bg-surface-strong disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Copy className="h-3.5 w-3.5" /> Copy cell
          </button>
          <button
            type="button"
            disabled={!selectedCell}
            onClick={() => copySelection("row")}
            className="flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-foreground-muted hover:bg-surface-strong disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Copy className="h-3.5 w-3.5" /> Copy row
          </button>
        </div>
      </div>
      <div
        ref={setScrollElement}
        tabIndex={0}
        role="grid"
        aria-rowcount={filteredCount}
        aria-colcount={columnCount}
        onKeyDown={handleKeyDown}
        className="relative min-h-0 flex-1 overflow-auto font-mono text-xs focus:outline-hidden"
        data-testid="csv-grid"
      >
        <div style={{ width: totalWidth }} className="sticky top-0 z-20 bg-surface-muted">
          {table.getHeaderGroups().map((headerGroup) => (
            <div key={headerGroup.id} className="flex border-b border-line-strong" role="row">
              <div
                className="sticky left-0 z-10 flex-none border-r border-line-strong bg-surface-muted"
                style={{ width: ROW_NUMBER_WIDTH }}
              />
              {headerGroup.headers.map((header) => {
                const sortDirection = header.column.getIsSorted();
                const columnType = (header.column.columnDef.meta as { columnType: CsvColumnType }).columnType;
                return (
                  <div
                    key={header.id}
                    role="columnheader"
                    aria-sort={sortDirection === "asc" ? "ascending" : sortDirection === "desc" ? "descending" : "none"}
                    className="relative flex-none border-r border-line/60"
                    style={{ width: header.getSize() }}
                  >
                    <button
                      type="button"
                      onClick={header.column.getToggleSortingHandler()}
                      data-testid={`csv-sort-${header.id}`}
                      title={`Sort by ${String(header.column.columnDef.header)}`}
                      className="flex w-full cursor-pointer items-center gap-1 px-2 py-1.5 text-left font-sans font-medium text-foreground-strong"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </span>
                      <span className="text-[10px] font-normal text-foreground-faint">{TYPE_LABELS[columnType]}</span>
                      {sortDirection === "asc" ? (
                        <ArrowUp className="h-3 w-3 text-brand" />
                      ) : sortDirection === "desc" ? (
                        <ArrowDown className="h-3 w-3 text-brand" />
                      ) : (
                        <ChevronsUpDown className="h-3 w-3 opacity-40" />
                      )}
                    </button>
                    <input
                      type="text"
                      value={String(header.column.getFilterValue() ?? "")}
                      onChange={(changeEvent) => header.column.setFilterValue(changeEvent.target.value || undefined)}
                      placeholder={columnType === "text" ? "Filter" : "Filter, >, <"}
                      aria-label={`Filter ${String(header.column.columnDef.header)}`}
                      data-testid={`csv-filter-${header.id}`}
                      className="mx-1 mb-1 h-6 w-[calc(100%-0.5rem)] rounded-sm border-line bg-field px-1.5 py-0 text-xs"
                    />
                    <div
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`Resize ${String(header.column.columnDef.header)}`}
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      onDoubleClick={() => autoFitColumn(header.index)}
                      className={mergeClassNames(
                        "absolute top-0 right-0 h-full w-1.5 cursor-col-resize select-none hover:bg-brand/60",
                        header.column.getIsResizing() && "bg-brand",
                      )}
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div style={{ height: rowVirtualizer.getTotalSize(), width: totalWidth }} className="relative">
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const row = visibleRows[virtualRow.index];
            if (!row) return null;
            const isRowSelected = selectedCell?.rowIndex === row.original.index;
            return (
              <div
                key={row.id}
                role="row"
                aria-rowindex={virtualRow.index + 1}
                data-testid="csv-row"
                className={mergeClassNames(
                  "absolute left-0 flex border-b border-line/40 even:bg-surface-subtle/50",
                  isRowSelected && "bg-brand/10 even:bg-brand/10",
                )}
                style={{ top: virtualRow.start, height: ROW_HEIGHT, width: totalWidth }}
              >
                <button
                  type="button"
                  title="Select row (Cmd/Ctrl+C copies it)"
                  onClick={() => setSelectedCell({ rowIndex: row.original.index })}
                  className="sticky left-0 z-10 flex-none cursor-pointer border-r border-line-strong bg-surface-muted px-2 text-right text-foreground-faint tabular-nums"
                  style={{ width: ROW_NUMBER_WIDTH }}
                >
                  {(row.original.index + (isFirstRowHeader ? 2 : 1)).toLocaleString()}
                </button>
                {row.getVisibleCells().map((cell, columnIndex) => {
                  const cellText = String(cell.getValue() ?? "");
                  const isCellSelected = isRowSelected && selectedCell?.columnIndex === columnIndex;
                  return (
                    <div
                      key={cell.id}
                      role="gridcell"
                      data-csv-cell
                      onClick={() => setSelectedCell({ rowIndex: row.original.index, columnIndex })}
                      className={mergeClassNames(
                        "flex-none cursor-default truncate border-r border-line/40 px-2 leading-7",
                        (columns[columnIndex]?.meta as { columnType: CsvColumnType } | undefined)?.columnType ===
                          "number" && "text-right tabular-nums",
                        isCellSelected && "outline outline-1 -outline-offset-1 outline-brand",
                      )}
                      style={{ width: cell.column.getSize() }}
                    >
                      {highlightMatches(cellText, globalFilter)}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        {filteredCount === 0 && (
          <p className="p-6 text-center font-sans text-sm text-foreground-muted">No rows match.</p>
        )}
      </div>
    </div>
  );
}
