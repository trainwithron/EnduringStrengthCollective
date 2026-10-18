// The team sheet as data: layout B, one sheet per rack, for one training day or for a week. Pure code (no database, no files): the loader fills it, the Excel and PDF writers draw it, and the upload (a later step)
// reads the sheet code back to know what each box means.
import type { SheetUnit } from "@/lib/team-sheet/cell-parser";

export const MAX_ATHLETES = 200;
export const MAX_RACKS = 60;
export const MIN_PER_RACK = 1;
export const MAX_PER_RACK = 6;
export const DEFAULT_PER_RACK = 4;
// What fits on one page of a rack sheet: more exercises than this continue on a second page of the same rack.
export const MAX_EXERCISES_PER_DAY = 8;
export const MAX_DAYS_PER_PAGE = 3;
export const MAX_COLUMNS_PER_PAGE = 12; // exercise columns on one page, all days together
export const MAX_EXERCISES_TOTAL = 40; // per sheet (the sheet code has to fit in a QR)
export const MAX_BOXES = 6; // set boxes drawn per exercise

export interface SheetExercise {
  /** group_workout_exercises.id: the column's meaning when the sheet comes back */
  id: string;
  name: string;
  /** "3x5", "3x8-10", "4x AMRAP" ... */
  prescription: string;
  /** number of set boxes to draw */
  sets: number;
  /** reps to assume for a weight written alone; null when the sheet is a range or AMRAP */
  reps: number | null;
  /** a timed, distance or height exercise (no weight, no reps): not read by the upload yet, written in Notes */
  unread: boolean;
  /** reps only (a pull-up, a push-up): what is written in the box is the reps of each set */
  repsOnly?: boolean;
}

export interface SheetDay {
  /** YYYY-MM-DD */
  date: string;
  /** "Tue Oct 21" */
  label: string;
  /** workout title(s) of that day, joined */
  title: string;
  exercises: SheetExercise[];
}

export interface SheetAthlete {
  id: string;
  /** "First L." (unique within the sheet) */
  name: string;
}

export interface SheetRack {
  number: number;
  athletes: SheetAthlete[];
}

export interface SheetModel {
  groupId: string;
  groupName: string;
  mode: "day" | "week";
  unit: SheetUnit;
  days: SheetDay[];
  racks: SheetRack[];
}

/** "Marcus Taylor" -> "Marcus T."; one word stays as it is; nothing becomes "Athlete". The last word is the surname. */
export function shortName(full: string | null | undefined): string {
  const words = String(full ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "Athlete";
  if (words.length === 1) return words[0];
  const last = words[words.length - 1];
  return `${words[0]} ${last[0].toUpperCase()}.`;
}

/** Sort key: surname, then first name, as typed (case and accents ignored). */
function sortKey(full: string): string {
  const words = full.trim().split(/\s+/).filter(Boolean);
  const last = words.length > 1 ? words[words.length - 1] : "";
  return `${last} ${words[0] ?? ""}`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Racks of `perRack` athletes in surname order. Two people who would both read "Sam R." get "Sam R. (2)" so a printed sheet is never ambiguous; the sheet code, not the name, says who is who.
 */
export function makeRacks(athletes: { id: string; fullName: string }[], perRack: number): SheetRack[] {
  const size = Math.min(MAX_PER_RACK, Math.max(MIN_PER_RACK, Math.floor(perRack) || DEFAULT_PER_RACK));
  const sorted = [...athletes].sort((a, b) => sortKey(a.fullName).localeCompare(sortKey(b.fullName)) || a.id.localeCompare(b.id));
  const seen = new Map<string, number>();
  const named = sorted.map((a) => {
    const base = shortName(a.fullName);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { id: a.id, name: n === 1 ? base : `${base} (${n})` };
  });
  const racks: SheetRack[] = [];
  for (let i = 0; i < named.length; i += size) racks.push({ number: racks.length + 1, athletes: named.slice(i, i + size) });
  return racks;
}

/** "3x5": the sets and reps a coach set for an exercise, from the per-set rows when there are any. */
export function describePrescription(row: { prescribed_sets?: number | null; prescribed_reps?: string | null; sets?: { target_reps?: string | null }[] | null; load_note?: string | null }): { text: string; sets: number; reps: number | null } {
  const perSet = (row.sets ?? []).map((s) => String(s.target_reps ?? "").trim()).filter((r) => r !== "");
  const count = Math.min(MAX_BOXES, Math.max(1, (row.sets && row.sets.length > 0 ? row.sets.length : row.prescribed_sets) || 3));
  let repsText = "";
  if (perSet.length > 0) repsText = perSet.every((r) => r === perSet[0]) ? perSet[0] : perSet.join("/");
  else repsText = String(row.prescribed_reps ?? "").trim();
  const reps = /^\d{1,3}$/.test(repsText) ? Number(repsText) : null;
  const note = String(row.load_note ?? "").trim();
  const base = repsText ? `${count}x${repsText.length <= 9 ? repsText : repsText.slice(0, 9)}` : `${count} sets`;
  return { text: note ? `${base} ${note.slice(0, 14)}` : base, sets: count, reps };
}

/** The seven dates of the week that holds `dateKey`, Monday first. */
export function weekDates(dateKey: string): string[] {
  const [y, m, d] = dateKey.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  const back = (base.getUTCDay() + 6) % 7; // Monday = 0
  const out: string[] = [];
  for (let i = 0; i < 7; i++) out.push(new Date(base.getTime() + (i - back) * 86400000).toISOString().slice(0, 10));
  return out;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Tue Oct 21" for 2026-10-21 */
export function dayLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${WEEKDAYS[dt.getUTCDay()]} ${MONTHS[m - 1]} ${d}`;
}

export const isDateKey = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "T00:00:00Z")) && new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v;

/**
 * How a rack's pages are cut: days in groups of MAX_DAYS_PER_PAGE, and a day with more than MAX_EXERCISES_PER_DAY exercises continues on further pages. Each page lists the day blocks it carries,
 * each with the slice of exercises on that page.
 */
export interface PageBlock {
  day: SheetDay;
  exercises: SheetExercise[];
  /** the position of the first of these exercises within its day */
  offset: number;
}
export function pageRack(days: SheetDay[]): PageBlock[][] {
  const blocks: PageBlock[] = [];
  for (const day of days) {
    for (let i = 0; i < Math.max(1, day.exercises.length); i += MAX_EXERCISES_PER_DAY) blocks.push({ day, exercises: day.exercises.slice(i, i + MAX_EXERCISES_PER_DAY), offset: i });
  }
  // a page takes up to MAX_DAYS_PER_PAGE blocks and MAX_COLUMNS_PER_PAGE exercise columns, whichever is reached first
  const pages: PageBlock[][] = [];
  let current: PageBlock[] = [];
  let columns = 0;
  for (const b of blocks) {
    const width = Math.max(1, b.exercises.length);
    if (current.length > 0 && (current.length >= MAX_DAYS_PER_PAGE || columns + width > MAX_COLUMNS_PER_PAGE)) {
      pages.push(current);
      current = [];
      columns = 0;
    }
    current.push(b);
    columns += width;
  }
  if (current.length > 0) pages.push(current);
  return pages;
}
