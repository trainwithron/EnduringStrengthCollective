import { MAX_DAYS_PER_RUN, daysPerWeekOf, type DaySlot } from "@/lib/ai-day-slots";

// What the coach asked the AI Program Builder for, read from their own words. Pure, so it is tested. The words that matter: how many weeks ("make it 4 weeks", "a 6 week block"), how many days a
// week ("3 days a week"), and "finish the week" (fill the empty days of the week that already has a day built). Anything it cannot read is left out and the program's own shape decides.

export interface BuildRequest {
  weeks: number | null;
  daysPerWeek: number | null;
  finishWeek: boolean;
}

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };

function numberFrom(token: string): number | null {
  const t = token.toLowerCase();
  if (/^\d+$/.test(t)) return Number(t);
  return WORDS[t] ?? null;
}

export function parseBuildRequest(text: string): BuildRequest {
  const t = text.toLowerCase();
  const word = "(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|twelve)";
  let weeks: number | null = null;
  const w = new RegExp(`${word}\\s*[- ]?\\s*(?:weeks?|wks?)\\b(?!\\s*(?:a|per|/)\\s*week)`).exec(t);
  if (w) {
    const n = numberFrom(w[1]);
    if (n != null && n >= 1 && n <= 24) weeks = n;
  }
  if (weeks == null && /\b(?:a|one|1)\s+month\b/.test(t)) weeks = 4;
  let daysPerWeek: number | null = null;
  const d = new RegExp(`${word}\\s*(?:days?|x|sessions?|workouts?)\\s*(?:a|per|/|each|every)\\s*(?:week|wk)`).exec(t) ?? new RegExp(`${word}\\s*[- ]?\\s*days?\\s*(?:program|split|week)\\b`).exec(t);
  if (d) {
    const n = numberFrom(d[1]);
    if (n != null && n >= 1 && n <= 7) daysPerWeek = n;
  }
  const finishWeek = /\b(?:finish|complete|fill(?:\s+in)?|rest of|do the rest of)\b[^.]{0,20}\b(?:the|this|that|my)\s+week\b/.test(t) || /\bfinish (?:the )?week\b/.test(t);
  return { weeks, daysPerWeek, finishWeek };
}

export interface ExistingDay {
  week: number;
  day: number;
  hasExercises: boolean;
}

// The days to build, in order: every (week, day) in the target shape that has no exercises yet, never one that does. The shape: days per week from the request, else the program's training days,
// else the days the program already shows (when more than one), else 3; weeks from the request, else just the week that is already under way ("finish the week"), else 4 for an empty program.
// At most MAX_DAYS_PER_RUN, so one run stays inside what one run is charged for.
export function planSlots(existing: ExistingDay[], request: BuildRequest, trainingDaysCount: number | null): DaySlot[] {
  const built = existing.filter((d) => d.hasExercises);
  const lastBuiltWeek = built.length > 0 ? Math.max(...built.map((d) => d.week)) : 0;
  const shown = daysPerWeekOf(existing);
  const dpw = request.daysPerWeek ?? (trainingDaysCount && trainingDaysCount > 0 ? trainingDaysCount : shown > 1 ? shown : 3);
  let weeks: number;
  if (request.weeks != null) weeks = request.weeks;
  else if (request.finishWeek || lastBuiltWeek > 0) weeks = Math.max(1, lastBuiltWeek);
  else weeks = 4;
  const hasAt = new Set(built.map((d) => `${d.week}:${d.day}`));
  const slots: DaySlot[] = [];
  for (let w = 1; w <= weeks; w++) {
    for (let d = 1; d <= dpw; d++) {
      if (!hasAt.has(`${w}:${d}`)) slots.push({ week: w, day: d });
    }
  }
  return slots.slice(0, MAX_DAYS_PER_RUN);
}

// Which built day a correction points at: "week 2 day 3", "day 2", or else the day built last (null = the caller's last day).
export function fixTargetFrom(text: string): { week: number | null; day: number } | null {
  const t = text.toLowerCase();
  const both = /week\s*(\d{1,2})\D{0,12}?day\s*(\d{1,2})/.exec(t);
  if (both) return { week: Number(both[1]), day: Number(both[2]) };
  const dayOnly = /\bday\s*(\d{1,2})\b/.exec(t);
  if (dayOnly) return { week: null, day: Number(dayOnly[1]) };
  return null;
}
