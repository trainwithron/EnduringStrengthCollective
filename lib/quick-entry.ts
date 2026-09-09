// Parses a single-line shorthand for adding an exercise without touching
// the mouse — "Bench 3x5 @7" -> name "Bench", 3 sets of "5" reps, RPE 7.
// Reps accepts a plain number or a range ("8-12") since that's already a
// first-class concept elsewhere in the builder (rep ranges, duplicate-week
// rep cycles). RPE is optional. Returns null for anything that doesn't
// match — the caller shows that as "couldn't parse," not a partial guess.
export interface QuickEntryResult {
  exerciseName: string;
  sets: number;
  reps: string;
  rpe: number | null;
}

const QUICK_ENTRY_PATTERN = /^(.+?)\s+(\d+)\s*[x×]\s*(\d+(?:-\d+)?)(?:\s*@\s*(\d+(?:\.\d+)?))?$/i;

export function parseQuickEntry(raw: string): QuickEntryResult | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const match = trimmed.match(QUICK_ENTRY_PATTERN);
  if (!match) return null;

  const [, name, setsRaw, reps, rpeRaw] = match;
  const sets = parseInt(setsRaw, 10);
  if (!Number.isFinite(sets) || sets <= 0 || sets > 20) return null;

  const exerciseName = name.trim();
  if (!exerciseName) return null;

  return {
    exerciseName,
    sets,
    reps,
    rpe: rpeRaw ? Number(rpeRaw) : null,
  };
}
