// Reads a filled team sheet file (Excel or CSV) back into plain cell text. Nothing is interpreted here and nothing is evaluated: a formula in a cell is never run (only the stored text of the cell is read), the sheet code
// says what each column and row means, and what the athletes wrote goes through the cell reader later. A file that is too big, not a spreadsheet, or has no sheet code is refused with a plain reason.
import * as XLSX from "xlsx";
import { decodeSheetCode, type SheetCode } from "@/lib/team-sheet/sheet-code";
import { CODES_SHEET, FORMULA_START } from "@/lib/team-sheet/export-xlsx";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_SHEETS = 60;
const MAX_CELL_CHARS = 120;
const MAX_ROWS_SCANNED = 80;
const MAX_COLS_SCANNED = 60;

export interface ParsedRack {
  code: SheetCode;
  /** one entry per athlete on the rack, in the code's order */
  rows: { athleteId: string; printedName: string; /** [day][exercise] raw cell text */ cells: string[][]; notes: string }[];
  /** the exercise names as printed in the header row, [day][exercise] (absent when the rows come back from the browser) */
  headers?: string[][];
}

export type ReadUpload = { ok: true; racks: ParsedRack[]; source: "xlsx" | "csv"; /** tabs that are not rack sheets and were left out */ ignoredSheets: string[] } | { ok: false; error: string };

const CODE_PATTERN = /^TS1\.[A-Za-z0-9_-]+\.[0-9a-f]{8}$/;

const MAX_CODE_CHARS = 8000;
// a number format that is just a number (General, 0, 0.00, #,##0): anything else (a date, a time, a percent) is a number the sheet did not mean as a weight
const PLAIN_NUMBER_FORMAT = /^(general|[#0,.\s_\-()?]*)$/i;
/** the text of a name the export wrote with a protective apostrophe in front of it (see plainText) */
export function unplain(value: string): string {
  return value.startsWith("'") && FORMULA_START.test(value.slice(1)) ? value.slice(1) : value;
}
function cellText(ws: XLSX.WorkSheet, r: number, c: number, max = MAX_CELL_CHARS): string {
  const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
  if (!cell || cell.v === undefined || cell.v === null) return "";
  // an error cell (#DIV/0!, #N/A) stores a number code, not a value: it is read as the error text, which the cell reader will not be sure of
  if (cell.t === "e") return String(cell.w ?? "#ERROR").slice(0, max);
  // a number the file shows as a date, a time or a percent is read as it is shown (never as the raw number behind it)
  if (cell.t === "n" && typeof cell.z === "string" && !PLAIN_NUMBER_FORMAT.test(cell.z.trim()) && typeof cell.w === "string") return cell.w.slice(0, max);
  // never a formula's text: only the value the file stored
  return String(cell.v).slice(0, max);
}

function findCode(ws: XLSX.WorkSheet): string | null {
  const range = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]) : null;
  if (!range) return null;
  for (let r = Math.min(range.e.r, MAX_ROWS_SCANNED * 3); r >= 0; r--) {
    for (let c = 0; c <= Math.min(range.e.c, 3); c++) {
      const t = cellText(ws, r, c, MAX_CODE_CHARS);
      if (CODE_PATTERN.test(t.trim())) return t.trim();
    }
  }
  return null;
}

// the code of rack n from the hidden sheet, for a sheet that does not carry its own
function codeFromCodesSheet(wb: XLSX.WorkBook, rack: number): string | null {
  const ws = wb.Sheets[CODES_SHEET];
  if (!ws) return null;
  const range = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]) : null;
  if (!range) return null;
  for (let r = 1; r <= Math.min(range.e.r, MAX_SHEETS + 1); r++) {
    if (Number(cellText(ws, r, 0)) === rack) {
      const t = cellText(ws, r, 1, MAX_CODE_CHARS).trim();
      return CODE_PATTERN.test(t) ? t : null;
    }
  }
  return null;
}

function readRack(ws: XLSX.WorkSheet, code: SheetCode): ParsedRack | { error: string } {
  const range = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]) : null;
  if (!range) return { error: `Rack ${code.rack} is empty.` };
  // the header row is the one that starts with "Athlete"
  let header = -1;
  for (let r = 0; r <= Math.min(range.e.r, MAX_ROWS_SCANNED); r++) {
    if (cellText(ws, r, 0).trim().toLowerCase() === "athlete") {
      header = r;
      break;
    }
  }
  if (header < 0) return { error: `Rack ${code.rack}: the Athlete row was not found. Was the sheet changed?` };
  // columns: one per exercise, in the order of the code (a day with no exercises holds one placeholder column), then Notes
  const columns = code.days.map((d) => Math.max(1, d.exercises.length));
  const exerciseColumns = columns.reduce((a, b) => a + b, 0);
  if (exerciseColumns + 2 > MAX_COLS_SCANNED + 2) return { error: `Rack ${code.rack} has too many columns.` };
  const headers: string[][] = [];
  {
    let col = 1;
    code.days.forEach((d, di) => {
      const list: string[] = [];
      for (let e = 0; e < d.exercises.length; e++) list.push(unplain(cellText(ws, header, col + e).trim()));
      headers[di] = list;
      col += columns[di];
    });
  }
  const rows: ParsedRack["rows"] = [];
  for (let i = 0; i < code.athletes.length; i++) {
    const r = header + 2 + i; // the prescription row sits between the header and the athletes
    const days: string[][] = [];
    let col = 1;
    code.days.forEach((d, di) => {
      const list: string[] = [];
      for (let e = 0; e < d.exercises.length; e++) list.push(cellText(ws, r, col + e));
      days[di] = list;
      col += columns[di];
    });
    rows.push({ athleteId: code.athletes[i], printedName: unplain(cellText(ws, r, 0).trim()), cells: days, notes: cellText(ws, r, 1 + exerciseColumns) });
  }
  return { code, rows, headers };
}

// An .xlsx is a zip, and the 5 MB limit is on the COMPRESSED size: a small file can unpack to gigabytes. The zip's own directory says how big every part will be, so it is read first and a file that would unpack to
// more than a team sheet could ever hold is refused before anything is unpacked.
export const MAX_ZIP_ENTRIES = 100;
export const MAX_UNPACKED_BYTES = 30 * 1024 * 1024;
export function zipLooksSafe(file: Buffer): boolean {
  const min = Math.max(0, file.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = file.length - 22; i >= min; i--) {
    if (file.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return false;
  const entries = file.readUInt16LE(eocd + 10);
  const dirSize = file.readUInt32LE(eocd + 12);
  const dirOffset = file.readUInt32LE(eocd + 16);
  if (entries === 0xffff || dirSize === 0xffffffff || dirOffset === 0xffffffff) return false; // zip64: not what a spreadsheet program writes for a team sheet
  if (entries > MAX_ZIP_ENTRIES || dirOffset + dirSize > file.length) return false;
  let pos = dirOffset;
  let total = 0;
  for (let i = 0; i < entries; i++) {
    if (pos + 46 > file.length || file.readUInt32LE(pos) !== 0x02014b50) return false;
    const size = file.readUInt32LE(pos + 24);
    if (size === 0xffffffff) return false;
    total += size;
    if (total > MAX_UNPACKED_BYTES) return false;
    pos += 46 + file.readUInt16LE(pos + 28) + file.readUInt16LE(pos + 30) + file.readUInt16LE(pos + 32);
  }
  return true;
}

// a CSV saved by Excel on Windows is often not UTF-8; read it the way it was written rather than showing broken letters (which would also make every name look changed)
function decodeCsv(file: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(file);
  } catch {
    return new TextDecoder("windows-1252").decode(file);
  }
}

export function readUpload(file: Buffer, filename: string): ReadUpload {
  if (file.length === 0) return { ok: false, error: "That file is empty." };
  if (file.length > MAX_UPLOAD_BYTES) return { ok: false, error: "That file is too large. A team sheet is well under 5 MB." };
  const lower = filename.toLowerCase();
  const isZip = file.subarray(0, 2).toString("latin1") === "PK";
  const isCsvName = lower.endsWith(".csv") || lower.endsWith(".txt");
  const isXlsxName = lower.endsWith(".xlsx");
  if (!isCsvName && !isXlsxName) return { ok: false, error: "Upload the Excel file (.xlsx) or a CSV of the sheet." };
  if (isXlsxName && !isZip) return { ok: false, error: "That does not look like an Excel file." };
  if (isCsvName && isZip) return { ok: false, error: "That is an Excel file with a CSV name. Rename it to .xlsx." };

  if (isXlsxName) {
    let safe = false;
    try {
      safe = zipLooksSafe(file);
    } catch {
      safe = false;
    }
    if (!safe) return { ok: false, error: "That file could not be read as a spreadsheet (it is far larger inside than a team sheet can be)." };
  }

  let wb: XLSX.WorkBook;
  try {
    // raw: a CSV box stays the text it is (10/10/8 and 5-3 and 2:30 are not dates and times)
    wb = isCsvName
      ? XLSX.read(decodeCsv(file).replace(/^\uFEFF/, ""), { type: "string", raw: true, cellFormula: false, cellHTML: false, cellStyles: false, sheetRows: 200 })
      : XLSX.read(file, { type: "buffer", cellNF: true, cellFormula: false, cellHTML: false, cellStyles: false, bookVBA: false, sheetRows: 200 });
  } catch {
    return { ok: false, error: "That file could not be read as a spreadsheet." };
  }
  const names = wb.SheetNames.filter((n) => n !== CODES_SHEET);
  if (names.length === 0) return { ok: false, error: "That file has no sheets." };
  if (names.length > MAX_SHEETS) return { ok: false, error: `That file has more than ${MAX_SHEETS} sheets.` };

  const racks: ParsedRack[] = [];
  const seen = new Set<number>();
  const ignoredSheets: string[] = [];
  try {
    for (const name of names) {
      const ws = Object.prototype.hasOwnProperty.call(wb.Sheets, name) ? wb.Sheets[name] : undefined;
      if (!ws) {
        ignoredSheets.push(name);
        continue;
      }
      const rackFromName = /^Rack (\d+)$/.exec(name)?.[1];
      let codeText = findCode(ws);
      if (!codeText && rackFromName) codeText = codeFromCodesSheet(wb, Number(rackFromName));
      if (!codeText) {
        // a sheet that is not a rack sheet at all (a note a coach added) is left out and named; a rack sheet without its code is a problem
        if (rackFromName) return { ok: false, error: `${name} has no sheet code, so it cannot be read. Use the Excel file made by the Team sheet page.` };
        ignoredSheets.push(name);
        continue;
      }
      const decoded = decodeSheetCode(codeText);
      if (!decoded.ok) return { ok: false, error: `${name}: ${decoded.reason}` };
      if (seen.has(decoded.code.rack)) return { ok: false, error: `Rack ${decoded.code.rack} is in the file twice.` };
      seen.add(decoded.code.rack);
      const rack = readRack(ws, decoded.code);
      if ("error" in rack) return { ok: false, error: rack.error };
      racks.push(rack);
    }
  } catch {
    return { ok: false, error: "That file could not be read as a team sheet." };
  }
  if (racks.length === 0) return { ok: false, error: "No team sheet was found in that file." };
  const group = racks[0].code.groupId;
  if (racks.some((r) => r.code.groupId !== group)) return { ok: false, error: "That file mixes sheets of different groups." };
  return { ok: true, racks, source: isCsvName ? "csv" : "xlsx", ignoredSheets };
}
