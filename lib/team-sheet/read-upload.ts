// Reads a filled team sheet file (Excel or CSV) back into plain cell text. Nothing is interpreted here and nothing is evaluated: a formula in a cell is never run (only the stored text of the cell is read), the sheet code
// says what each column and row means, and what the athletes wrote goes through the cell reader later. A file that is too big, not a spreadsheet, or has no sheet code is refused with a plain reason.
import * as XLSX from "xlsx";
import { decodeSheetCode, type SheetCode } from "@/lib/team-sheet/sheet-code";
import { CODES_SHEET } from "@/lib/team-sheet/export-xlsx";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_SHEETS = 60;
const MAX_CELL_CHARS = 120;
const MAX_ROWS_SCANNED = 80;
const MAX_COLS_SCANNED = 60;

export interface ParsedRack {
  code: SheetCode;
  /** one entry per athlete on the rack, in the code's order */
  rows: { athleteId: string; printedName: string; /** [day][exercise] raw cell text */ cells: string[][]; notes: string }[];
}

export type ReadUpload = { ok: true; racks: ParsedRack[]; source: "xlsx" | "csv" } | { ok: false; error: string };

const CODE_PATTERN = /^TS1\.[A-Za-z0-9_-]+\.[0-9a-f]{8}$/;

const MAX_CODE_CHARS = 8000;
function cellText(ws: XLSX.WorkSheet, r: number, c: number, max = MAX_CELL_CHARS): string {
  const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
  if (!cell || cell.v === undefined || cell.v === null) return "";
  // never a formula's text: only the value the file stored
  const v = typeof cell.v === "number" || typeof cell.v === "boolean" ? String(cell.v) : String(cell.v);
  return v.slice(0, max);
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
    rows.push({ athleteId: code.athletes[i], printedName: cellText(ws, r, 0).trim(), cells: days, notes: cellText(ws, r, 1 + exerciseColumns) });
  }
  return { code, rows };
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

  let wb: XLSX.WorkBook;
  try {
    wb = isCsvName
      ? XLSX.read(file.toString("utf8"), { type: "string", cellFormula: false, cellHTML: false, cellStyles: false, sheetRows: 200 })
      : XLSX.read(file, { type: "buffer", cellFormula: false, cellHTML: false, cellStyles: false, bookVBA: false, sheetRows: 200 });
  } catch {
    return { ok: false, error: "That file could not be read as a spreadsheet." };
  }
  const names = wb.SheetNames.filter((n) => n !== CODES_SHEET);
  if (names.length === 0) return { ok: false, error: "That file has no sheets." };
  if (names.length > MAX_SHEETS) return { ok: false, error: `That file has more than ${MAX_SHEETS} sheets.` };

  const racks: ParsedRack[] = [];
  const seen = new Set<number>();
  for (const name of names) {
    const ws = wb.Sheets[name];
    const rackFromName = /^Rack (\d+)$/.exec(name)?.[1];
    let codeText = findCode(ws);
    if (!codeText && rackFromName) codeText = codeFromCodesSheet(wb, Number(rackFromName));
    if (!codeText) {
      // a sheet that is not a rack sheet at all (a note a coach added) is skipped; a rack sheet without its code is a problem
      if (rackFromName) return { ok: false, error: `${name} has no sheet code, so it cannot be read. Use the Excel file made by the Team sheet page.` };
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
  if (racks.length === 0) return { ok: false, error: "No team sheet was found in that file." };
  const group = racks[0].code.groupId;
  if (racks.some((r) => r.code.groupId !== group)) return { ok: false, error: "That file mixes sheets of different groups." };
  return { ok: true, racks, source: isCsvName ? "csv" : "xlsx" };
}
