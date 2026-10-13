// Server-side limits on what the AI writes into a program, applied to every row it produces before anything is saved or shown. The prompt asks for sensible numbers; this does not trust the prompt.
// A number that is merely too big or small is brought into range (sets, effort, rep counts); a number that would be a real-world mistake if kept (a weight, a time) is dropped to empty so the coach
// fills it in. The red review list (lib/program-validation.ts) still flags anything that looks odd.

export const MAX_SETS = 20;
export const MAX_REPS_NUMBER = 100;
export const MAX_WEIGHT = 2000; // pounds or kilos, whatever the coach's unit
export const MAX_TIME_SECONDS = 7200; // two hours
const MAX_TEXT = 40;

export interface ClampableRow {
  sets: number;
  reps: string | null;
  weight: number | null;
  rpe: number | null;
  rest: string | null;
  timeSeconds: number | null;
}

// "8", "8-10", "AMRAP", "10 each side": any number inside is held to 1..100; other words are kept; the whole text is cut to 40 characters.
export function clampReps(reps: string | null): string | null {
  if (reps == null) return null;
  const text = reps.trim();
  if (!text) return null;
  // Only a plain rep count is clamped (digits, ranges, x, each side, AMRAP). Anything with a unit (400m, 200 yd, 30 sec, 150 cal) stays as written.
  const withoutWords = text.replace(/amrap|each\s+(?:side|leg|arm)|per\s+(?:side|leg|arm)|reps?/gi, "");
  if (/[^\d\s.\-–x×+/,]/i.test(withoutWords)) return text.slice(0, MAX_TEXT);
  const clamped = text.replace(/\d+(?:\.\d+)?/g, (n) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return n;
    return String(Math.min(MAX_REPS_NUMBER, Math.max(1, Math.round(v))));
  });
  return clamped.slice(0, MAX_TEXT);
}

export function clampAiRow<T extends ClampableRow>(row: T): T {
  const sets = Number.isFinite(row.sets) ? Math.min(MAX_SETS, Math.max(1, Math.round(row.sets))) : 1;
  const rpe = row.rpe != null && Number.isFinite(row.rpe) ? Math.min(10, Math.max(1, Math.round(row.rpe * 2) / 2)) : null;
  const weight = row.weight != null && Number.isFinite(row.weight) && row.weight >= 0 && row.weight <= MAX_WEIGHT ? row.weight : null;
  const timeSeconds = row.timeSeconds != null && Number.isFinite(row.timeSeconds) && row.timeSeconds >= 1 && row.timeSeconds <= MAX_TIME_SECONDS ? Math.round(row.timeSeconds) : null;
  return { ...row, sets, reps: clampReps(row.reps), weight, rpe, rest: row.rest != null ? row.rest.trim().slice(0, MAX_TEXT) || null : null, timeSeconds };
}
