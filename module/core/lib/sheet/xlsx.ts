/** Spreadsheet column name: 0 → A, 25 → Z, 26 → AA. */
const column = (i: number) => {
  let name = "";
  for (i++; i; i = Math.floor((i - 1) / 26)) name = String.fromCharCode(65 + (i - 1) % 26) + name;
  return name;
};

/** Text as XML: escaped, without what XML cannot hold, cut to what a cell can hold. */
const text = (value: string) => value
  .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]/g, "")
  .slice(0, 32767)
  .replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const RELS = "http://schemas.openxmlformats.org/package/2006/relationships";
const DOC = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const SHEET = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml";

/**
 * Rows as an Excel workbook (.xlsx) with one sheet, for people: it opens in every Excel, whatever its
 * language, and in LibreOffice, Google Sheets and Numbers. Numbers stay numbers; everything else is
 * text, which never runs as a formula; a list becomes "a, b".
 */
export async function xlsx(rows: unknown[][]): Promise<Uint8Array> {
  const { strToU8, zipSync } = await import("fflate"); // only for who exports
  const cell = (v: unknown, ref: string) => typeof v === "number" && Number.isFinite(v)
    ? `<c r="${ref}"><v>${v}</v></c>`
    : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${text([v ?? ""].flat().join(", "))}</t></is></c>`;
  const data = rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cell(v, column(c) + (r + 1))).join("")}</row>`);
  const files: Record<string, string> = {
    "[Content_Types].xml": `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="${TYPE}.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="${TYPE}.worksheet+xml"/></Types>`,
    "_rels/.rels": `${XML}<Relationships xmlns="${RELS}"><Relationship Id="rId1" Type="${DOC}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `${XML}<workbook xmlns="${SHEET}" xmlns:r="${DOC}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `${XML}<Relationships xmlns="${RELS}"><Relationship Id="rId1" Type="${DOC}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `${XML}<worksheet xmlns="${SHEET}"><sheetData>${data.join("")}</sheetData></worksheet>`,
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, xml]) => [name, strToU8(xml)])));
}
