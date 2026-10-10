import type { ParsedImportRow } from "@/lib/workout-import-parser";

// Checks an AI-built program's rows for things that are almost certainly wrong, so the coach sees a plain red list before signing it off. It only FLAGS: nothing is changed,
// the coach decides. Pure; no database. Training maxes (lower-case exercise name -> estimated max) are optional and only used when a specific client was chosen.

export interface ProgramFlag {
  message: string;
}

const MAX_SETS = 10;
const MAX_DAYS_PER_WEEK = 7;

function weekNumber(label: string): number | null {
  const m = /(\d+)/.exec(label);
  return m ? Number(m[1]) : null;
}

// "8", "8-10", "10 each side" -> [8] / [8, 10] / [10]. AMRAP and the like give [].
export function repNumbers(reps: string | null | undefined): number[] {
  if (!reps) return [];
  const found = reps.match(/\d+(?:\.\d+)?/g);
  return found ? found.slice(0, 2).map(Number) : [];
}

export function validateProgramRows(rows: ParsedImportRow[], opts: { trainingMaxes?: Map<string, number> } = {}): ProgramFlag[] {
  const flags: ProgramFlag[] = [];
  const where = (r: ParsedImportRow) => `${r.week}, ${r.day}`;
  const seen = new Map<string, number>();
  const daysByWeek = new Map<string, Set<string>>();

  for (const r of rows) {
    if (r.rpe != null && (r.rpe < 1 || r.rpe > 10)) {
      flags.push({ message: `"${r.exerciseName}" (${where(r)}) has an effort (RPE) of ${r.rpe}. It should be between 1 and 10.` });
    }
    if (r.sets > MAX_SETS) {
      flags.push({ message: `"${r.exerciseName}" (${where(r)}) has ${r.sets} sets. That is more than ${MAX_SETS}.` });
    }
    if (r.timeSeconds == null) {
      const reps = repNumbers(r.reps);
      if (reps.some((n) => n < 1 || n > 50)) {
        flags.push({ message: `"${r.exerciseName}" (${where(r)}) has ${r.reps} reps. Reps are usually between 1 and 50.` });
      }
    }
    const key = `${r.week}|${r.day}|${r.exerciseName.trim().toLowerCase()}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
    const days = daysByWeek.get(r.week) ?? new Set<string>();
    days.add(r.day);
    daysByWeek.set(r.week, days);

    const max = opts.trainingMaxes?.get(r.exerciseName.trim().toLowerCase());
    if (max != null && max > 0 && r.weight != null && r.weight > max * 1.1) {
      flags.push({ message: `"${r.exerciseName}" (${where(r)}) is ${r.weight}, which is above this client's recorded max of ${max}.` });
    }
  }

  for (const [key, n] of seen) {
    if (n > 1) {
      const [week, day, name] = key.split("|");
      flags.push({ message: `"${name}" appears ${n} times in ${week}, ${day}.` });
    }
  }
  for (const [week, days] of daysByWeek) {
    if (days.size > MAX_DAYS_PER_WEEK) flags.push({ message: `${week} has ${days.size} training days. A week has 7.` });
  }

  // A missing week in the middle (Week 1, Week 3) means an empty week.
  const numbers = Array.from(new Set([...daysByWeek.keys()].map(weekNumber).filter((n): n is number => n != null))).sort((a, b) => a - b);
  for (let i = 1; i < numbers.length; i++) {
    for (let w = numbers[i - 1] + 1; w < numbers[i]; w++) flags.push({ message: `Week ${w} is empty.` });
  }
  return flags;
}
