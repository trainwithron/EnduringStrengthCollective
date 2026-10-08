// Timed work (pure): a plank for 60 seconds is a time, not 60 reps. Used by the builder's quick-add line, the spreadsheet importer, the AI readers and the generated programs, so "planks 60 seconds"
// lands as sets of 60 seconds the same way everywhere, and the exercise tracks Time.

// A duration written out: "60s", "60 sec", "60 seconds", "1 min", "1.5 minutes", "1:30". A bare number is not a duration here (that needs to know the exercise: see isTimedHold). The letter m on its
// own is left out because it also means metres.
export const DURATION_SOURCE = "(?:\\d+(?:\\.\\d+)?\\s*(?:seconds?|secs?|minutes?|mins?|s)\\b|\\d{1,2}:\\d{2})";
const DURATION_WHOLE = new RegExp(`^${DURATION_SOURCE}$`, "i");

// The whole text as a number of seconds, or null when it is not a duration.
export function parseDurationSeconds(text: string | null | undefined): number | null {
  const t = (text ?? "").trim().toLowerCase();
  if (!t || !DURATION_WHOLE.test(t)) return null;
  const clock = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (clock) {
    const secs = Number(clock[2]);
    return secs < 60 ? Number(clock[1]) * 60 + secs : null;
  }
  const m = /^(\d+(?:\.\d+)?)\s*([a-z]+)$/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  const seconds = /^m/.test(m[2]) ? n * 60 : n;
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : null;
}

// Exercises that are held for time. A plank that moves (a plank row, a plank jack, a walkout) is counted in reps, so those are left out. Carries are not here: a carry is timed only when its
// time is typed with a unit.
const HOLD_WORDS = /\b(planks?|side planks?|wall[- ]?sits?|dead[- ]?hangs?|active hangs?|passive hangs?|bar hangs?|hollow (body )?holds?|hollow rocks? hold|l[- ]?sits?|isometric|iso hold|static hold|[a-z]+ holds?|holds?)\b/i;
const MOVING_PLANK = /\b(row|jack|walk[- ]?out|tap|taps|shoulder|to |up[- ]?down|reach|drag|pull[- ]?through|knee|crawl|saw|rock|push[- ]?up|pushup|climber)\b/i;

export function isTimedHold(name: string): boolean {
  const n = name.trim();
  if (!n) return false;
  if (!HOLD_WORDS.test(n)) return false;
  if (/\bplank/i.test(n) && MOVING_PLANK.test(n) && !/\bhold\b/i.test(n)) return false;
  return true;
}

// A bare number with no unit on a timed hold means seconds, but only from 5 up (1 to 4 would be reps of something odd).
export const MIN_BARE_SECONDS = 5;

export interface TimedRowLike {
  exerciseName: string;
  reps: string | null;
  timeSeconds: number | null;
}

// Moves a duration that was written in the reps place into the time place, and reads a bare number on a timed hold as seconds. Rows that already have a time, or no reps, are left as they are.
export function normalizeTimedRow<T extends TimedRowLike>(row: T): T {
  if (row.timeSeconds != null || row.reps == null) return row;
  const dur = parseDurationSeconds(row.reps);
  if (dur != null) return { ...row, reps: null, timeSeconds: dur };
  const bare = /^\d+$/.test(row.reps.trim()) ? Number(row.reps.trim()) : null;
  if (bare != null && bare >= MIN_BARE_SECONDS && isTimedHold(row.exerciseName)) return { ...row, reps: null, timeSeconds: bare };
  return row;
}
