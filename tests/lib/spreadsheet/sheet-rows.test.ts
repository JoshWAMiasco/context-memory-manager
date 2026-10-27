import { describe, expect, it } from "vitest";
import { formatSheetCell, toSheetTable } from "@/lib/spreadsheet/sheet-rows";

describe("spreadsheet cells as text", () => {
  it("show numbers, dates, booleans and empty cells like a spreadsheet would", () => {
    expect(formatSheetCell(1200)).toBe("1200");
    expect(formatSheetCell(new Date(Date.UTC(2024, 2, 1)))).toBe("2024-03-01");
    expect(formatSheetCell(new Date(Date.UTC(2024, 2, 1, 9, 30)))).toBe("2024-03-01 09:30:00");
    expect(formatSheetCell(true)).toBe("TRUE");
    expect(formatSheetCell(null)).toBe("");
  });

  it("leave out trailing empty rows and stop at the row limit", () => {
    const table = toSheetTable("Budget", [["Item", "Cost"], ["Rent", 1200], [null, null], []], 10);
    expect(table).toMatchObject({ name: "Budget", columnCount: 2, isTruncated: false, totalRows: 2 });
    expect(table.rows).toEqual([
      ["Item", "Cost"],
      ["Rent", "1200"],
    ]);
    const limited = toSheetTable("Long", [["a"], ["b"], ["c"]], 2);
    expect(limited).toMatchObject({ isTruncated: true, totalRows: 3 });
    expect(limited.rows).toHaveLength(2);
  });
});
