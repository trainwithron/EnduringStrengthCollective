import type { PdfLine } from "@/lib/simple-pdf";

// Graduation (Release U1). A team player can have a graduation year ("class of 2027"). When a coach starts next season, a player whose class has graduated is left unticked by default, and each of them is emailed,
// once, a PDF of their own training history.
//   Graduated means: the graduation year is this year or earlier, by the calendar year of the day the season is started. (A class of 2027 is unticked from January 2027 on; a coach who rolls over in the autumn
//   before can untick them by hand. It is only the starting tick: the coach decides.)
export function graduatedByYear(now: Date = new Date()): number {
  return now.getFullYear();
}

export function hasGraduated(graduationYear: number | null | undefined, now: Date = new Date()): boolean {
  return typeof graduationYear === "number" && Number.isFinite(graduationYear) && graduationYear <= graduatedByYear(now);
}

// What the coach types in the class-year box: nothing clears it; four digits between 1990 and 2100 sets it; anything else is refused (null with ok false).
export function parseGraduationYear(raw: string): { ok: boolean; value: number | null } {
  const t = raw.trim();
  if (t === "") return { ok: true, value: null };
  if (!/^\d{4}$/.test(t)) return { ok: false, value: null };
  const n = Number(t);
  return n >= 1990 && n <= 2100 ? { ok: true, value: n } : { ok: false, value: null };
}

export interface HistorySet {
  weight: number | null;
  reps: number | null;
}
export interface HistoryExercise {
  name: string;
  sets: HistorySet[];
}
export interface HistorySession {
  date: string; // yyyy-mm-dd
  title: string;
  groupName: string;
  exercises: HistoryExercise[];
}

const trimNum = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

export function formatSet(s: HistorySet, unit: string): string {
  if (s.weight != null && s.reps != null) return `${trimNum(s.weight)}${s.weight === 0 ? "" : ` ${unit}`} x ${s.reps}`;
  if (s.reps != null) return `${s.reps} reps`;
  if (s.weight != null) return `${trimNum(s.weight)} ${unit}`;
  return "done";
}

// The lines of the PDF: who and what it covers, a short summary, the best set of every lift, then every session in date order. Pure, so the PDF can be tested without a database.
export function historyLines(args: { fullName: string; teamName: string; unit: string; sessions: HistorySession[]; preparedOn: string }): PdfLine[] {
  const { fullName, teamName, unit, preparedOn } = args;
  const sessions = [...args.sessions].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.title.localeCompare(b.title)));
  const lines: PdfLine[] = [];
  lines.push({ text: `${fullName}` , bold: true });
  lines.push({ text: `With ${teamName}. Prepared ${preparedOn}. This is your own training record; it was sent only to you.` });
  lines.push({ text: "" });

  const totalSets = sessions.reduce((n, s) => n + s.exercises.reduce((m, e) => m + e.sets.length, 0), 0);
  lines.push({ text: "Summary", bold: true });
  if (sessions.length === 0) {
    lines.push({ text: "No completed workouts were logged in the app." });
    return lines;
  }
  lines.push({ text: `${sessions.length} workout${sessions.length === 1 ? "" : "s"} from ${sessions[0].date} to ${sessions[sessions.length - 1].date}, ${totalSets} set${totalSets === 1 ? "" : "s"} logged.` });
  lines.push({ text: "" });

  // the heaviest logged set of each lift (with its reps), alphabetically
  const best = new Map<string, { weight: number; reps: number | null; date: string }>();
  for (const s of sessions) {
    for (const e of s.exercises) {
      for (const set of e.sets) {
        if (set.weight == null || set.weight <= 0) continue;
        const key = e.name.trim();
        const cur = best.get(key);
        if (!cur || set.weight > cur.weight || (set.weight === cur.weight && (set.reps ?? 0) > (cur.reps ?? 0))) best.set(key, { weight: set.weight, reps: set.reps, date: s.date });
      }
    }
  }
  if (best.size > 0) {
    lines.push({ text: "Heaviest set of each lift", bold: true });
    for (const [name, b] of [...best.entries()].sort((a, c) => a[0].localeCompare(c[0]))) {
      lines.push({ text: `${name}: ${formatSet({ weight: b.weight, reps: b.reps }, unit)} (${b.date})` });
    }
    lines.push({ text: "" });
  }

  lines.push({ text: "Every workout", bold: true });
  for (const s of sessions) {
    lines.push({ text: "" });
    lines.push({ text: `${s.date}  ${s.title}${s.groupName ? ` (${s.groupName})` : ""}`, bold: true });
    for (const e of s.exercises) {
      if (e.sets.length === 0) continue;
      lines.push({ text: `   ${e.name}: ${e.sets.map((x) => formatSet(x, unit)).join(", ")}` });
    }
  }
  return lines;
}

export function graduationEmail(args: { firstName: string; teamName: string }): { subject: string; text: string } {
  const { firstName, teamName } = args;
  return {
    subject: `Your training history from ${teamName}`,
    text: `Hi ${firstName},

Congratulations on graduating. Your coach has started next season, so here is a copy of your own training record from ${teamName}: every workout you logged and your heaviest set of each lift, as a PDF.

This was sent only to you, at the address you sign in with. Your coach, your team and your family did not get a copy. Keep it, or share it if you like.

Your account and everything in it stay yours.

Spotlight Coaching`,
  };
}
