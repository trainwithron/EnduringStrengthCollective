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
  // A named "N-day split / program / week" is the week's shape and wins over an "N days a week" said about part of it (Ron, Nov 23: "5-day split ... 3 days a week full body ...
  // on the days in between ... core, cardio and mobility" is 5 days, not 3).
  // A named "N-day" over 7 is the program's LENGTH ("a 28-day program, 4 days a week"), not its week: then the "N days a week" wording decides.
  for (const re of [new RegExp(`${word}\\s*[- ]?\\s*days?\\s*(?:program|split|week)\\b`), new RegExp(`${word}\\s*(?:days?|x|sessions?|workouts?)\\s*(?:a|per|/|each|every)\\s*(?:week|wk)`)]) {
    const d = re.exec(t);
    const n = d ? numberFrom(d[1]) : null;
    if (n != null && n >= 1 && n <= 7) {
      daysPerWeek = n;
      break;
    }
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
// else the days the program already shows (when more than one), else 3; weeks from the request, else just the week that is already under way ("finish the week"), else ONE week for an empty program (never a longer program than the coach's words ask for).
// At most MAX_DAYS_PER_RUN, so one run stays inside what one run is charged for.
// The days of each week of the run: the request's own number, else the program's training days, else the days the program already shows (when more than one), else 3. The box
// sends it with every day it builds, so the day being written knows the week it belongs to (where its mobility days go: lib/ai-day-rules.ts mobilityDayPlan).
export function weekDaysFor(existing: ExistingDay[], request: Pick<BuildRequest, "daysPerWeek">, trainingDaysCount: number | null): number {
  const shown = daysPerWeekOf(existing);
  return request.daysPerWeek ?? (trainingDaysCount && trainingDaysCount > 0 ? trainingDaysCount : shown > 1 ? shown : 3);
}

export function planSlots(existing: ExistingDay[], request: BuildRequest, trainingDaysCount: number | null): DaySlot[] {
  const built = existing.filter((d) => d.hasExercises);
  const lastBuiltWeek = built.length > 0 ? Math.max(...built.map((d) => d.week)) : 0;
  const dpw = weekDaysFor(existing, request, trainingDaysCount);
  let weeks: number;
  if (request.weeks != null) weeks = request.weeks;
  else if (request.finishWeek || lastBuiltWeek > 0) weeks = Math.max(1, lastBuiltWeek);
  else weeks = 1;
  const hasAt = new Set(built.map((d) => `${d.week}:${d.day}`));
  const slots: DaySlot[] = [];
  for (let w = 1; w <= weeks; w++) {
    for (let d = 1; d <= dpw; d++) {
      if (!hasAt.has(`${w}:${d}`)) slots.push({ week: w, day: d });
    }
  }
  return slots.slice(0, MAX_DAYS_PER_RUN);
}

// Resuming a paused run (Ron, Nov 24: a 5-day request built only days 3 to 5). The run was paused after days 1 and 2; he deleted the week, typed his new request and it went in as
// a correction to the OLD run, which carried on with its queue (days 3 to 5). Two rules:
//  * nothing the run built is still there (the week was deleted or cleared): what is typed is a NEW request, planned from scratch (`isFreshStart`);
//  * otherwise the queue is planned again over the run's weeks from what is there NOW, so a day deleted meanwhile is built again, in order (`replanQueue`).
export function isFreshStart(existing: ExistingDay[], builtByRun: DaySlot[]): boolean {
  if (builtByRun.length === 0) return false;
  return !builtByRun.some((s) => existing.some((d) => d.week === s.week && d.day === s.day && d.hasExercises));
}

export function replanQueue(existing: ExistingDay[], run: { weeks: number[]; daysPerWeek: number }): DaySlot[] {
  const has = new Set(existing.filter((d) => d.hasExercises).map((d) => `${d.week}:${d.day}`));
  const slots: DaySlot[] = [];
  for (const w of [...new Set(run.weeks)].sort((a, b) => a - b)) {
    for (let d = 1; d <= run.daysPerWeek; d++) if (!has.has(`${w}:${d}`)) slots.push({ week: w, day: d });
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

// A scope the coach types while it is building ("only one week", "just week one", "no more than two weeks", "I didn't ask for more than one week"): the number of weeks to stop after, or null.
const SCOPE_WORD = "(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|twelve|a single)";
export function scopeLimitFrom(text: string): { weeks: number; phrase: string } | null {
  const t = text.toLowerCase();
  const patterns = [
    new RegExp(`\\b(?:only|just)\\s+${SCOPE_WORD}\\s+weeks?\\b`),
    new RegExp(`\\b(?:only|just)\\s+week\\s+${SCOPE_WORD}\\b`),
    new RegExp(`\\b(?:no more than|not more than|didn'?t ask for more than|did not ask for more than)\\s+${SCOPE_WORD}\\s+weeks?\\b`),
  ];
  for (const p of patterns) {
    const m = p.exec(t);
    if (!m) continue;
    const token = m[1] === "a single" ? "one" : m[1];
    const n = numberFrom(token);
    if (n != null && n >= 1 && n <= 24) return { weeks: n, phrase: m[0] };
  }
  return null;
}
