// Parses a single-line shorthand for adding an exercise without touching the mouse:
//   "Bench 3x5 @7"        -> 3 sets of 5 reps at RPE 7
//   "Row 3x8-12 @8"       -> a rep range
//   "Plank 60 seconds"    -> 3 sets of 60 seconds (a time, never reps)
//   "Plank 3x60s", "Wall sit 3 x 1 min", "Side plank 45s each side"
//   "Plank 60"            -> on a known timed hold a bare number is seconds
//   "5 minute row"        -> one 5 minute effort
// A duration with a unit always means time. Sets default to 3 when not typed (a single leading duration is one effort). RPE is optional. Returns null for anything that doesn't match; the
// caller shows that as "couldn't parse," not a partial guess.
import { DURATION_SOURCE, MIN_BARE_SECONDS, isTimedHold, parseDurationSeconds } from "@/lib/timed-exercise";

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
}

const RPE_TAIL = /\s*@\s*(\d+(?:\.\d+)?)\s*$/;
const SIDE_TAIL = /\s+(?:each|per)\s+side\s*$/i;
const SETS_BY_DURATION = new RegExp(`^(.+?)\\s+(\\d+)\\s*[x×]\\s*(${DURATION_SOURCE})$`, "i");
const SETS_BY_REPS = /^(.+?)\s+(\d+)\s*[x×]\s*(\d+(?:-\d+)?)$/i;
const JUST_DURATION = new RegExp(`^(.+?)\\s+(${DURATION_SOURCE})$`, "i");
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

  const done = (r: Omit<QuickEntryResult, "rpe" | "eachSide">): QuickEntryResult | null => {
    const name = r.exerciseName.trim();
    if (!name || !setsOk(r.sets)) return null;
    return { ...r, exerciseName: name, rpe, eachSide };
  };

  let m = SETS_BY_DURATION.exec(text);
  if (m) {
    const t = parseDurationSeconds(m[3]);
    return t == null ? null : done({ exerciseName: m[1], sets: parseInt(m[2], 10), reps: null, timeSeconds: t });
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
    const t = parseDurationSeconds(m[2]);
    return t == null ? null : done({ exerciseName: m[1], sets: DEFAULT_QUICK_SETS, reps: null, timeSeconds: t });
  }

  m = LEADING_DURATION.exec(text);
  if (m) {
    const t = parseDurationSeconds(m[1]);
    return t == null ? null : done({ exerciseName: m[2], sets: 1, reps: null, timeSeconds: t });
  }

  m = BARE_NUMBER.exec(text);
  if (m && Number(m[2]) >= MIN_BARE_SECONDS && isTimedHold(m[1])) {
    return done({ exerciseName: m[1], sets: DEFAULT_QUICK_SETS, reps: null, timeSeconds: Number(m[2]) });
  }

  return null;
}
