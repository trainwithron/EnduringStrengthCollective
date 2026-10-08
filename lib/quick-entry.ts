// Parses a single-line shorthand for adding an exercise without touching the mouse:
//   "Bench 3x5 @7"        -> 3 sets of 5 reps at RPE 7
//   "Row 3x8-12 @8"       -> a rep range
//   "Plank 60 seconds"    -> 3 sets of 60 seconds (a time, never reps)
//   "Plank 3x60s", "Wall sit 3 x 1 min", "Side plank 45s each side"
//   "Plank 60"            -> on a known timed hold a bare number is seconds
//   "5 minute row"        -> one 5 minute effort
// A duration with a unit always means time. Sets default to 3 when not typed (a single leading duration is one effort). RPE is optional. Returns null for anything that doesn't match; the
// caller shows that as "couldn't parse," not a partial guess.
import { DURATION_SOURCE, MIN_BARE_SECONDS, RANGE_SOURCE, isTimedHold, parseDurationRange, parseDurationSeconds } from "@/lib/timed-exercise";

export interface QuickEntryResult {
  exerciseName: string;
  sets: number;
  // Reps as typed ("5", "8-12"), or null for a timed exercise.
  reps: string | null;
  // Seconds per set for a timed exercise, else null.
  timeSeconds: number | null;
  rpe: number | null;
  // "each side" / "per side" was typed.
  eachSide: boolean;
  // The range as typed when the time was a range ("30-45s": the upper end is the time), else null.
  rangeNote: string | null;
}

const RPE_TAIL = /\s*@\s*(\d+(?:\.\d+)?)\s*$/;
const SIDE_TAIL = /\s+(?:each|per)\s+side\s*$/i;
const SETS_BY_DURATION = new RegExp(`^(.+?)\\s+(\\d+)\\s*[x×]\\s*(${RANGE_SOURCE}|${DURATION_SOURCE})$`, "i");
const SETS_BY_REPS = /^(.+?)\s+(\d+)\s*[x×]\s*(\d+(?:-\d+)?)$/i;
const JUST_DURATION = new RegExp(`^(.+?)\\s+(${RANGE_SOURCE}|${DURATION_SOURCE})$`, "i");
const LEADING_DURATION = new RegExp(`^(${DURATION_SOURCE})\\s+(.+)$`, "i");
const BARE_NUMBER = /^(.+?)\s+(\d+)$/;

export const DEFAULT_QUICK_SETS = 3;

function setsOk(n: number): boolean {
  return Number.isFinite(n) && n > 0 && n <= 20;
}

export function parseQuickEntry(raw: string): QuickEntryResult | null {
  let text = raw.trim();
  if (!text) return null;

  let rpe: number | null = null;
  const rpeMatch = RPE_TAIL.exec(text);
  if (rpeMatch) {
    rpe = Number(rpeMatch[1]);
    text = text.slice(0, rpeMatch.index).trim();
  }
  let eachSide = false;
  if (SIDE_TAIL.test(text)) {
    eachSide = true;
    text = text.replace(SIDE_TAIL, "").trim();
  }

  const done = (r: Omit<QuickEntryResult, "rpe" | "eachSide" | "rangeNote"> & { rangeNote?: string | null }): QuickEntryResult | null => {
    const name = r.exerciseName.trim();
    if (!name || !setsOk(r.sets)) return null;
    return { ...r, exerciseName: name, rpe, eachSide, rangeNote: r.rangeNote ?? null };
  };
  // A time typed as a range uses its upper end and keeps the range as a note.
  const timeOf = (text: string): { seconds: number; rangeNote: string | null } | null => {
    const range = parseDurationRange(text);
    if (range) return { seconds: range.seconds, rangeNote: range.note };
    const seconds = parseDurationSeconds(text);
    return seconds == null ? null : { seconds, rangeNote: null };
  };

  let m = SETS_BY_DURATION.exec(text);
  if (m) {
    const t = timeOf(m[3]);
    return t == null ? null : done({ exerciseName: m[1], sets: parseInt(m[2], 10), reps: null, timeSeconds: t.seconds, rangeNote: t.rangeNote });
  }

  m = SETS_BY_REPS.exec(text);
  if (m) {
    const sets = parseInt(m[2], 10);
    const reps = m[3];
    // "Plank 3x60": on a timed hold a bare number is seconds, not reps
    if (/^\d+$/.test(reps) && Number(reps) >= MIN_BARE_SECONDS && isTimedHold(m[1])) return done({ exerciseName: m[1], sets, reps: null, timeSeconds: Number(reps) });
    return done({ exerciseName: m[1], sets, reps, timeSeconds: null });
  }

  m = JUST_DURATION.exec(text);
  if (m) {
    const t = timeOf(m[2]);
    if (t == null) return null;
    // A hold or a short effort is repeated for sets (3 by default); a long effort typed after the name ("Bike 20 min") is one effort, like "5 minute row".
    const sets = isTimedHold(m[1]) || t.seconds <= 120 ? DEFAULT_QUICK_SETS : 1;
    return done({ exerciseName: m[1], sets, reps: null, timeSeconds: t.seconds, rangeNote: t.rangeNote });
  }

  m = LEADING_DURATION.exec(text);
  if (m) {
    const t = parseDurationSeconds(m[1]);
    // The name that follows is capitalized ("5 minute row" is a Row).
    const name = m[2].trim();
    return t == null ? null : done({ exerciseName: name.charAt(0).toUpperCase() + name.slice(1), sets: 1, reps: null, timeSeconds: t });
  }

  m = BARE_NUMBER.exec(text);
  if (m && Number(m[2]) >= MIN_BARE_SECONDS && isTimedHold(m[1])) {
    return done({ exerciseName: m[1], sets: DEFAULT_QUICK_SETS, reps: null, timeSeconds: Number(m[2]) });
  }

  return null;
}

// The note saved with the exercise for what was typed beyond sets and time: "Each side", and the range when the time was one ("30-45s"). Null when there is nothing to note.
export function quickNote(r: Pick<QuickEntryResult, "eachSide" | "rangeNote">): string | null {
  const parts = [r.eachSide ? "Each side" : null, r.rangeNote ? "Hold " + r.rangeNote : null].filter((p): p is string => !!p);
  return parts.length > 0 ? parts.join(". ") : null;
}
