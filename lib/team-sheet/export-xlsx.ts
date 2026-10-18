// The team sheet as an Excel file: layout B, one worksheet per rack, the same columns as the paper sheet, one cell per exercise where the athlete's (or the coach's) weights are typed the same way they are written
// on paper ("225 235 245", "225x5 235x3", "BW", "-"). A hidden worksheet "_codes" holds each rack's sheet code, which is how an upload knows what the sheet is. Plain SheetJS, no styles beyond widths and merges.
import * as XLSX from "xlsx";
import { encodeSheetCode } from "@/lib/team-sheet/sheet-code";
import { rackCode, instructionLines } from "@/lib/team-sheet/export-pdf";
import type { SheetModel } from "@/lib/team-sheet/sheet-model";

export const CODES_SHEET = "_codes";
export const CODE_LABEL = "Sheet code (do not edit)";

// A text cell that starts with = + - or @ (or a tab or carriage return) can be run as a formula when the file is opened, or saved as CSV and opened again. Names and exercise names come from people, so every text cell
// that could start that way gets a leading apostrophe, which Excel reads as "this is text" and the sheet shows as a quote mark. Cells are also always written as text cells, never as formulas.
export const FORMULA_START = /^[=+\-@\t\r]/;
export function plainText(value: string): string {
  return FORMULA_START.test(value) ? "'" + value : value;
}
const safeRows = (rows: (string | number)[][]): (string | number)[][] => rows.map((r) => r.map((c) => (typeof c === "string" ? plainText(c) : c)));
// aoa_to_sheet makes strings text cells; this makes sure nothing in the sheet is a formula (an "f" entry) whatever went in.
function onlyText(ws: XLSX.WorkSheet): XLSX.WorkSheet {
  for (const key of Object.keys(ws)) {
    if (key.startsWith("!")) continue;
    const cell = ws[key] as XLSX.CellObject;
    if (cell && typeof cell === "object") delete (cell as { f?: string }).f;
  }
  return ws;
}

export function buildSheetWorkbook(model: SheetModel): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const week = model.mode === "week";
  const first = model.days[0];
  for (const rack of model.racks) {
    const rows: (string | number)[][] = [];
    const merges: XLSX.Range[] = [];
    const exerciseCount = model.days.reduce((s, d) => s + Math.max(1, d.exercises.length), 0);
    const lastCol = 1 + exerciseCount; // name + exercises, then Notes at lastCol
    rows.push([week ? `Rack ${rack.number} - Week of ${first.label}` : `Rack ${rack.number} - ${first.label}${first.title ? " - " + first.title : ""}`]);
    rows.push([`${model.groupName} - ${rack.athletes.length} athlete${rack.athletes.length === 1 ? "" : "s"} on this rack - weights in ${model.unit}`]);
    for (const line of instructionLines(model.unit)) rows.push([line]);
    rows.push([]);
    const headTop = rows.length;
    // day band (a week), exercise names, prescriptions
    const band: string[] = [""];
    const names: string[] = ["Athlete"];
    const rx: string[] = [""];
    let col = 1;
    for (const d of model.days) {
      const list = d.exercises.length > 0 ? d.exercises : [null];
      band.push(`${d.label}${d.title ? " - " + d.title : ""}`);
      for (let i = 1; i < list.length; i++) band.push("");
      if (list.length > 1) merges.push({ s: { r: headTop, c: col }, e: { r: headTop, c: col + list.length - 1 } });
      for (const ex of list) {
        names.push(ex ? ex.name : "(no exercises)");
        rx.push(ex ? (ex.unread ? "timed: use Notes" : ex.prescription) : "");
      }
      col += list.length;
    }
    band.push("");
    names.push("Notes");
    rx.push("");
    if (week) {
      rows.push(band);
    } else {
      rows.push([]);
    }
    rows.push(names);
    rows.push(rx);
    for (const a of rack.athletes) {
      const r: string[] = [a.name];
      for (let i = 1; i <= exerciseCount; i++) r.push("");
      r.push("");
      rows.push(r);
    }
    // The sheet's own code, in plain sight below the athletes, so a sheet saved as CSV (which keeps only one worksheet and none of the hidden ones) still says what it is.
    rows.push([]);
    rows.push([CODE_LABEL, encodeSheetCode(rackCode(model, rack))]);
    const ws = onlyText(XLSX.utils.aoa_to_sheet(safeRows(rows)));
    ws["!cols"] = [{ wch: 18 }, ...Array.from({ length: exerciseCount }, () => ({ wch: 16 })), { wch: 30 }];
    merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(1, lastCol) } });
    ws["!merges"] = merges;
    XLSX.utils.book_append_sheet(wb, ws, `Rack ${rack.number}`);
  }
  // the codes, one per rack, on a worksheet people do not see
  const codeRows: (string | number)[][] = [["rack", "sheet code (do not edit)"], ...model.racks.map((rk) => [rk.number, encodeSheetCode(rackCode(model, rk))])];
  XLSX.utils.book_append_sheet(wb, onlyText(XLSX.utils.aoa_to_sheet(safeRows(codeRows))), CODES_SHEET);
  wb.Workbook = { Sheets: wb.SheetNames.map((name) => ({ name, Hidden: name === CODES_SHEET ? 1 : 0 })) } as XLSX.WorkBook["Workbook"];
  return wb;
}

export function buildSheetXlsx(model: SheetModel): Buffer {
  return Buffer.from(XLSX.write(buildSheetWorkbook(model), { type: "buffer", bookType: "xlsx" }));
}
