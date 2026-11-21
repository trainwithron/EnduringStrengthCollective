// A photo of a filled-in PRINTED team sheet (Ron, Nov 20: "build the simple version"), read into the same thing a spreadsheet upload gives (lib/team-sheet/read-upload.ts ParsedRack),
// so it goes through the same review, save and undo. Pure, so every rule is tested; the route is app/api/team-sheet/photo.
//
//   - Which sheet it is comes from the printed QR sheet code, decoded in the browser (never read by the model). No code: nothing is read (the coach takes the photo again).
//   - The model only copies what is written in each box of the page it sees, with whether it is sure. It is told the sheet's own exercise names and how many athletes it has.
//   - Columns: the page's printed exercise names, matched to one run of the code's columns in order (a rack can run over two pages). A page whose names do not match the code's
//     exercises is refused, never guessed at.
//   - Rows: in printed order, the code's athletes in order; the printed name goes through the review's own name check (lib/team-sheet/review.ts alignRack). No name is matched
//     across the organization.
//   - A box the model is not sure of, or could not read, makes its whole cell "?": the cell reader marks it unsure, the review highlights it, and it saves nothing until the coach
//     types what the paper says. Nothing is ever guessed.
import type { SheetCode } from "@/lib/team-sheet/sheet-code";
import type { ParsedRack } from "@/lib/team-sheet/read-upload";
import { dayLabel } from "@/lib/team-sheet/sheet-model";

/** What a cell becomes when any box in it could not be read with certainty: the cell reader reads it as unsure (blank, highlighted, never saved as it is). */
export const UNCLEAR_CELL = "?";
export const MAX_PHOTOS = 4;
// One box's text is short ("225x5", "BW", "-"); anything longer is not a box.
const MAX_BOX_CHARS = 16;
const MAX_NOTE_CHARS = 120;

export const TEAM_SHEET_PHOTO_PROMPT = `You read a photo of ONE printed page of a gym team sheet that athletes filled in by hand.
The page is a table: a row per athlete (the athlete's printed name in the first column), and a column per exercise, with small boxes in each cell, one box per set. A Notes column is at the right.
A small capitalised section word printed above an exercise name (WARM-UP, STRENGTH, CONDITIONING) is a section label: it is not part of the name, so leave it out of "columns".
Copy exactly what is handwritten in each box. Never work anything out, never fill a box in from the boxes around it, never correct what was written.
A box's text is what was written: a weight ("225", "132.5"), a weight and reps ("225x5"), "BW", "-", "X", or "" when the box is empty.
For EVERY box also say whether you are sure: "sure": false when the writing is smudged, crossed out, ambiguous, partly outside the box or cut off in the photo, or you are not certain of every character.
Return ONLY this JSON, nothing else:
{"columns": ["<the exercise name printed at the top of each exercise column, left to right, as printed>"],
 "rows": [{"name": "<the athlete name printed on the row, exactly as printed, with its full stop and any number in brackets, e.g. Sam R. (2)>", "cells": [[{"text": "<box 1>", "sure": true}, {"text": "<box 2>", "sure": true}]], "notes": {"text": "<what is written in Notes>", "sure": true}}]}
"cells" has one list per exercise column, in the same order as "columns", each with the boxes of that cell left to right, top to bottom.
Rows top to bottom, only rows that have a printed athlete name. If the photo is not a team sheet, or the table cannot be seen, return {"error": "<why>"}.`;

/** The words that go with the photo: the sheet's own exercise names (in order) and how many athletes it has, so the model knows what it is looking at. */
export function photoUserText(code: SheetCode, exerciseNames: Map<string, string>): string {
  const cols = code.days.flatMap((d) => d.exercises.map((id) => `${dayLabel(d.date)}: ${exerciseNames.get(id) ?? "(exercise)"}`));
  return [
    `This sheet has ${code.athletes.length} athlete row${code.athletes.length === 1 ? "" : "s"} and these exercise columns in order (a long sheet may show only some of them on this page):`,
    ...cols.map((c, i) => `${i + 1}. ${c}`),
    "Read the page and return the JSON described.",
  ].join("\n");
}

export interface PhotoBox {
  text: string;
  sure: boolean;
}
export interface PhotoRow {
  name: string;
  cells: PhotoBox[][];
  notes: PhotoBox;
}
export interface PhotoReading {
  columns: string[];
  rows: PhotoRow[];
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "");
const box = (v: unknown, max = MAX_BOX_CHARS): PhotoBox => {
  const o = (v ?? {}) as { text?: unknown; sure?: unknown };
  const raw = typeof o.text === "string" ? o.text : typeof o.text === "number" ? String(o.text) : "";
  const text = raw.replace(/[\u0000-\u001f]/g, " ").trim();
  // a box longer than a box can hold is not something we can trust
  return { text: text.slice(0, max), sure: o.sure === true && text.length <= max };
};

/** The model's JSON, checked. An "error" reply, or anything not shaped like the reading, is refused with a plain reason. */
export function parsePhotoReading(json: unknown): { ok: true; reading: PhotoReading } | { ok: false; error: string } {
  const j = (json ?? {}) as { error?: unknown; columns?: unknown; rows?: unknown };
  if (typeof j.error === "string" && j.error.trim()) return { ok: false, error: `The photo could not be read as a team sheet: ${j.error.trim().slice(0, 160)}` };
  if (!Array.isArray(j.columns) || !Array.isArray(j.rows)) return { ok: false, error: "The photo could not be read as a team sheet. Take it again with the whole page flat and in view." };
  const columns = j.columns.slice(0, 40).map((c) => str(c, 120));
  const rows = j.rows.slice(0, 12).map((r) => {
    const o = (r ?? {}) as { name?: unknown; cells?: unknown; notes?: unknown };
    const cells = Array.isArray(o.cells) ? o.cells.slice(0, 40).map((c) => (Array.isArray(c) ? c.slice(0, 12).map((b) => box(b)) : [])) : [];
    return { name: str(o.name, 80), cells, notes: box(o.notes, MAX_NOTE_CHARS) };
  });
  return { ok: true, reading: { columns, rows } };
}

/** A name as compared: lower case, letters and digits only. A printed name cut short on paper ("Romanian Deadl…") still matches the start of the full one. */
export function normName(s: string): string {
  return s.toLowerCase().replace(/[…]|\.\.\.$/g, "").replace(/[^a-z0-9]/g, "");
}
function namesMatch(printed: string, full: string): boolean {
  const p = normName(printed);
  const f = normName(full);
  if (!p || !f) return false;
  return p === f || (p.length >= 4 && f.startsWith(p));
}

/** Where the page's columns sit among the code's columns: the one starting index where every printed name matches in order, or null when none (or more than one) does. */
export function matchColumns(printed: string[], codeColumns: string[]): number | null {
  if (printed.length === 0 || printed.length > codeColumns.length) return null;
  const starts: number[] = [];
  for (let s = 0; s + printed.length <= codeColumns.length; s++) {
    if (printed.every((p, i) => namesMatch(p, codeColumns[s + i]))) starts.push(s);
  }
  return starts.length === 1 ? starts[0] : null;
}

/** One cell's text from its boxes: the boxes written in it joined with spaces ("225x5 235x3"); any box not read with certainty makes it "?". */
export function cellFromBoxes(boxes: PhotoBox[]): { text: string; unclear: boolean } {
  if (boxes.some((b) => !b.sure)) return { text: UNCLEAR_CELL, unclear: true };
  const written = boxes.map((b) => b.text).filter((t) => t !== "");
  return { text: written.join(" "), unclear: false };
}

/** The reading of one page, as the rack its code names. Cells on columns this page does not show stay empty. */
export function rackFromPhoto(
  code: SheetCode,
  exerciseNames: Map<string, string>,
  reading: PhotoReading
): { ok: true; rack: ParsedRack; unclear: number } | { ok: false; error: string } {
  const flat = code.days.flatMap((d, di) => d.exercises.map((id, ei) => ({ di, ei, name: exerciseNames.get(id) ?? "" })));
  const start = matchColumns(reading.columns, flat.map((c) => c.name));
  if (start === null) return { ok: false, error: "The exercise names on this page don't match the sheet its code belongs to. Take the photo again, or print the sheet again from today's Team sheet page." };
  if (reading.rows.length !== code.athletes.length) {
    return { ok: false, error: `This sheet was printed with ${code.athletes.length} athlete row${code.athletes.length === 1 ? "" : "s"}, and ${reading.rows.length} could be read. Take the photo again with every row in view.` };
  }
  let unclear = 0;
  const rows: ParsedRack["rows"] = code.athletes.map((athleteId, ri) => {
    const r = reading.rows[ri];
    const cells: string[][] = code.days.map((d) => d.exercises.map(() => ""));
    reading.columns.forEach((_, ci) => {
      const target = flat[start + ci];
      const c = cellFromBoxes(r.cells[ci] ?? []);
      if (c.unclear) unclear++;
      cells[target.di][target.ei] = c.text;
    });
    const notes = r.notes.sure ? r.notes.text : "";
    return { athleteId, printedName: r.name, cells, notes };
  });
  return { ok: true, rack: { code, rows }, unclear };
}

/** Pages of the same rack, in one review: each cell from the page that shows it; the same cell read differently on two photos is "?". */
export function mergeRacks(racks: ParsedRack[]): ParsedRack[] {
  const byRack = new Map<string, ParsedRack>();
  for (const r of racks) {
    const key = `${r.code.groupId}:${r.code.rack}:${r.code.days.map((d) => d.date).join(",")}`;
    const had = byRack.get(key);
    if (!had) {
      byRack.set(key, { ...r, rows: r.rows.map((row) => ({ ...row, cells: row.cells.map((d) => [...d]) })) });
      continue;
    }
    had.rows.forEach((row, ri) => {
      const other = r.rows[ri];
      if (!other) return;
      row.cells.forEach((day, di) =>
        day.forEach((t, ei) => {
          const o = other.cells[di]?.[ei] ?? "";
          if (o === "") return;
          day[ei] = t === "" || t === o ? o : UNCLEAR_CELL;
        })
      );
      if (!row.notes && other.notes) row.notes = other.notes;
      if (!row.printedName && other.printedName) row.printedName = other.printedName;
    });
  }
  return Array.from(byRack.values());
}
