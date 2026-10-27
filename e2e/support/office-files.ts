import { createWriteStream } from "node:fs";
import archiver from "archiver";

/*
 * Minimal, valid Office files for the viewers, built as the zip packages they are: an xlsx with
 * two sheets, and a docx with a heading, a table and two links (one of them a javascript: link
 * that must end up inert).
 */

async function writeZip(filePath: string, parts: Record<string, string>): Promise<void> {
  const archive = archiver("zip");
  const output = createWriteStream(filePath);
  const closed = new Promise<void>((resolve, reject) => {
    output.on("close", resolve);
    archive.on("error", reject);
  });
  archive.pipe(output);
  for (const [name, content] of Object.entries(parts)) archive.append(content, { name });
  await archive.finalize();
  await closed;
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function inlineCell(reference: string, value: string | number): string {
  return typeof value === "number"
    ? `<c r="${reference}"><v>${value}</v></c>`
    : `<c r="${reference}" t="inlineStr"><is><t>${value}</t></is></c>`;
}

function sheetXml(rows: (string | number)[][]): string {
  const body = rows
    .map(
      (row, rowIndex) =>
        `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => inlineCell(`${String.fromCodePoint(65 + columnIndex)}${rowIndex + 1}`, value)).join("")}</row>`,
    )
    .join("");
  return `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

/** An xlsx with the sheets "Budget" and "Notes". */
export function writeWorkbook(filePath: string): Promise<void> {
  return writeZip(filePath, {
    "[Content_Types].xml": `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    "_rels/.rels": `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/><sheet name="Notes" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": sheetXml([
      ["Item", "Cost"],
      ["Rent", 1200],
      ["Groceries", 350.5],
    ]),
    "xl/worksheets/sheet2.xml": sheetXml([["Remember the second sheet"]]),
  });
}

/** A docx with a heading, a two-cell table, an https link and a javascript: link. */
export function writeWordDocument(filePath: string): Promise<void> {
  const wordNamespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const relationshipsNamespace = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
  return writeZip(filePath, {
    "[Content_Types].xml": `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    "_rels/.rels": `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/_rels/document.xml.rels": `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdGood" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/handbook" TargetMode="External"/><Relationship Id="rIdBad" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="javascript:alert(document.cookie)" TargetMode="External"/></Relationships>`,
    "word/document.xml": `${XML}<w:document xmlns:w="${wordNamespace}" xmlns:r="${relationshipsNamespace}"><w:body>
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${run("Quarterly report")}</w:p>
      <w:p>${run("Revenue grew steadily this quarter.")}</w:p>
      <w:tbl><w:tr><w:tc><w:p>${run("Region")}</w:p></w:tc><w:tc><w:p>${run("North")}</w:p></w:tc></w:tr></w:tbl>
      <w:p><w:hyperlink r:id="rIdGood">${run("Handbook")}</w:hyperlink></w:p>
      <w:p><w:hyperlink r:id="rIdBad">${run("Do not click")}</w:hyperlink></w:p>
    </w:body></w:document>`,
  });
}
