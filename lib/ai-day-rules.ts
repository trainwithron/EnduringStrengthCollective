// Small, pure rules the AI Program Builder applies to the day it just wrote (and tells the model before it writes): no repeated exercise in a day, how many mobility days a week, timed work
// written the same way every day, plain library names, and a sensible day length. Pure, so each is tested.

import { matchExercise, sameQualifiers, type AliasEntry } from "@/lib/exercise-matching";
import { mentionsExercise } from "@/lib/builder-context";

import { isTimedHold } from "@/lib/timed-exercise";

export interface DayRow {
  exerciseName: string;
  sets: number;
  reps: string | null;
  weight: number | null;
  rpe: number | null;
  rest: string | null;
  timeSeconds: number | null;
}

// ---- the same exercise twice in one day ----

const REPEAT_WORDS = /\b(twice|two times|again|repeat|repeated|double up|back[- ]to[- ]back|superset|multiple times)\b/i;

export function allowsRepeats(text: string): boolean {
  return REPEAT_WORDS.test(text);
}

export const ruleKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Keeps the first of any exercise that appears twice in one day (same name, ignoring case and punctuation) unless the coach's words ask for repeats.
export function dedupeDay<T extends { exerciseName: string }>(rows: T[], allowRepeat: boolean): { rows: T[]; removed: string[] } {
  if (allowRepeat) return { rows, removed: [] };
  const seen = new Set<string>();
  const out: T[] = [];
  const removed: string[] = [];
  for (const r of rows) {
    const k = ruleKey(r.exerciseName);
    if (seen.has(k)) {
      removed.push(r.exerciseName);
      continue;
    }
    seen.add(k);
    out.push(r);
  }
  return { rows: out, removed };
}

// ---- mobility days ----

const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, a: 1 };

// "2 of the days are mobility", "two mobility days", "make 2 days mobility": how many days a week the coach wants as mobility days, or null.
// Ron, Nov 24 (by voice): "5 day split 3 Days full body to Mobility days in between" built all 5 days as mobility, because "5 day ... mobility" was read as 5. So:
//  * a count reaches "mobility" only across a short gap (20 characters) with no other number, "to"/"too", "split", "program", "week", "full body", comma or "and" in it;
//  * phones write "two" as "to" or "too": "to mobility days" is 2 (only right before "mobility day(s)/session(s)");
//  * the count must be LESS than the week's days (`daysInWeek`, when known); otherwise it is not believed (null), unless the words say all / every day mobility.
const MOBILITY_GAP_STOP = /\d|\b(?:one|two|three|four|five|six|seven|to|too|and)\b|split|program|week|full\s*body|,/;
export function mobilityDaysWanted(text: string, daysInWeek: number | null = null): number | null {
  const t = text.toLowerCase();
  const word = "(\\d|one|two|three|four|five)";
  let found: string | null = null;
  // "2 days a week will be mobility": "a / per / each week" right after the day word belongs to the count, not to the gap
  for (const m of t.matchAll(new RegExp(`${word}\\s+(?:of\\s+(?:the\\s+|my\\s+)?)?(?:days?|sessions?|workouts?)(?:\\s+(?:a|per|each)\\s+week)?\\b([^.\\n]{0,20}?)\\bmobility\\b`, "g"))) {
    if (!MOBILITY_GAP_STOP.test(m[2])) {
      found = m[1];
      break;
    }
  }
  if (found == null) {
    const b = new RegExp(`\\b(\\d|one|two|three|four|five|to|too)\\s+mobility\\s+(?:days?|sessions?|workouts?)\\b`).exec(t);
    if (b) found = b[1] === "to" || b[1] === "too" ? "2" : b[1];
  }
  if (found == null) return null;
  const n = NUM[found] ?? Number(found);
  if (!Number.isFinite(n) || n < 1 || n > 5) return null;
  const allMobility = /\ball\b[^.\n]{0,20}\bmobility\b|\bevery\s+day\b[^.\n]{0,20}\bmobility\b|\bmobility\b[^.\n]{0,12}\bevery\s+day\b/.test(t);
  if (daysInWeek != null && daysInWeek > 0 && n >= daysInWeek && !allMobility) return null;
  return n;
}

export type MobilityRole = "must" | "must_not" | "free";

// For the day being written: of the week's days, `wanted` are mobility days. `builtMobility` of the days already built in this week are; `daysLeft` counts this day and the days after it that still
// have no exercises. If every remaining day is needed as a mobility day, this one is; if enough are already there, this one is not.
export function mobilityRole(opts: { wanted: number | null; builtMobility: number; daysLeft: number }): MobilityRole {
  if (opts.wanted == null) return "free";
  const need = opts.wanted - opts.builtMobility;
  if (need <= 0) return "must_not";
  if (need >= opts.daysLeft) return "must";
  return "free";
}

// ---- where the mobility days go (Ron, Nov 24: a 5-day split, "3 day a week full body ... 2 days a week will be Mobility" came out Mobility, Mobility, Mobility, Full Body, Full
// Body, because the early days were left to the model; he wants Full Body, Mobility, Full Body, Mobility, Full Body) ----

// The week's days that are mobility days (1-based), planned up front so every day knows its role, the same every week (Pause, Resume and the next week included).
// The days the coach named win ("mobility Tuesday and Thursday", "days 2 and 4"). Otherwise the main days go first and last, and the mobility days evenly between them; when there
// are more mobility days than gaps between main days, the main days are spread out instead.
export function mobilityDayPlan(daysInWeek: number, wanted: number, named: number[] | null = null): number[] {
  const d = Math.max(1, Math.min(7, Math.round(daysInWeek)));
  if (named && named.length > 0) return [...new Set(named.filter((n) => n >= 1 && n <= d))].sort((a, b) => a - b);
  const m = Math.max(0, Math.min(d, Math.round(wanted)));
  if (m === 0) return [];
  if (m >= d) return Array.from({ length: d }, (_, i) => i + 1);
  const mains = d - m;
  if (mains >= m + 1) {
    // main days in m + 1 groups (the larger groups first), a mobility day after each group but the last
    const base = Math.floor(mains / (m + 1));
    const extra = mains % (m + 1);
    const out: number[] = [];
    let at = 0;
    for (let g = 0; g < m; g++) {
      at += base + (g < extra ? 1 : 0) + 1;
      out.push(at);
    }
    return out;
  }
  // fewer main days than gaps: the main days spread over the week (first and last), mobility everywhere else
  const mainDays = new Set(mains === 1 ? [Math.ceil(d / 2)] : Array.from({ length: mains }, (_, i) => Math.round((i * (d - 1)) / (mains - 1)) + 1));
  return Array.from({ length: d }, (_, i) => i + 1).filter((n) => !mainDays.has(n));
}

// The weekdays and day numbers the coach tied to mobility ("mobility Tuesday and Thursday", "Tuesday and Thursday are mobility", "mobility on days 2 and 4"), as days of the week's
// plan (1-based). A weekday is the program's own training day in that position when the program has a schedule (`trainingDays`, 0 = Sunday), else Monday = day 1. Null when none.
const WEEKDAY_WORDS: [RegExp, number][] = [
  [/^sun(day)?s?$/, 0], [/^mon(day)?s?$/, 1], [/^tue(s|sday)?s?$/, 2], [/^wed(nesday)?s?$/, 3], [/^thu(r|rs|rsday)?s?$/, 4], [/^fri(day)?s?$/, 5], [/^sat(urday)?s?$/, 6],
];
const NAMED_FILLER = new Set(["and", "&", "on", "the", "are", "is", "be", "will", "for", "as", "work", "days", "day", "sessions", "session", "to", "of", "both", "only", "plus"]);
export function namedMobilityDays(text: string, daysInWeek: number, trainingDays: number[] | null = null): number[] | null {
  const order = trainingDays && trainingDays.length > 0 ? [...new Set(trainingDays)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)) : null;
  const dayOfWeekday = (wd: number): number | null => {
    const n = order ? order.indexOf(wd) + 1 : ((wd + 6) % 7) + 1;
    return n >= 1 && n <= daysInWeek ? n : null;
  };
  const out = new Set<number>();
  for (const sentence of text.toLowerCase().split(/[.;!?\n]/)) {
    const words = sentence.split(/[^a-z0-9&]+/).filter(Boolean);
    words.forEach((w, i) => {
      if (w !== "mobility") return;
      const walk = (step: 1 | -1): number[] => {
        const found: number[] = [];
        let afterDay = false;
        for (let j = i + step; j >= 0 && j < words.length; j += step) {
          const t = words[j];
          const wd = WEEKDAY_WORDS.find(([re]) => re.test(t));
          if (wd) {
            const n = dayOfWeekday(wd[1]);
            if (n) found.push(n);
            continue;
          }
          if (/^\d$/.test(t) && (afterDay || (step === -1 && /^days?$/.test(words[j - 1] ?? "")))) {
            const n = Number(t);
            if (n >= 1 && n <= daysInWeek) found.push(n);
            continue;
          }
          if (step === 1 && /^days?$/.test(t)) {
            afterDay = true;
            continue;
          }
          if (NAMED_FILLER.has(t)) continue;
          break;
        }
        return found;
      };
      const right = walk(1);
      for (const n of right.length > 0 ? right : walk(-1)) out.add(n);
    });
  }
  return out.size > 0 ? [...out].sort((a, b) => a - b) : null;
}

// The role of one day from the week's plan: a mobility day, or not one. Never "free" once the plan is known.
export function planRole(day: number, plan: number[]): MobilityRole {
  return plan.includes(day) ? "must" : "must_not";
}

export function isMobilityTitle(title: string): boolean {
  return /\bmobility\b/i.test(title);
}

// `plan` (the week's planned mobility days) names them, so a main day early in the week is told the truth ("days 2 and 4 are the mobility days"), not "already has its mobility days".
export function mobilityInstruction(role: MobilityRole, wanted: number | null, plan: number[] | null = null): string | null {
  if (wanted == null || role === "free") return null;
  const which = plan && plan.length > 0 ? ` (day${plan.length === 1 ? "" : "s"} ${plan.join(" and ")} of the week)` : "";
  if (role === "must") return `This week has ${wanted} mobility day${wanted === 1 ? "" : "s"}${which}, and this is one of them: build a mobility day (mostly mobility, joint-range and stretching work, no heavy lifting) and call it "Mobility".`;
  if (plan) return `This week's mobility day${plan.length === 1 ? " is" : "s are"} ${plan.length === 0 ? "none" : `day${plan.length === 1 ? "" : "s"} ${plan.join(" and ")}`}: this is a main training day, NOT a mobility day.`;
  return `This week already has its ${wanted} mobility day${wanted === 1 ? "" : "s"}: this is NOT a mobility day.`;
}

// ---- timed work is written the same way every day ----

// Foam rolling, stretches and breathing are always timed; holds (a plank, a wall sit, a dead hang) are decided by the same rule the rest of the app uses (isTimedHold), so "Hang Clean" and "Plank Row" stay reps.
const TIMED_ONLY = /\b(foam roll(?:ing)?|stretch(?:es)?|breathing|couch stretch)\b/i;

export function isTimedName(name: string): boolean {
  return isTimedHold(name) || TIMED_ONLY.test(name);
}

// A timed item with no time of its own (foam rolling, a stretch, a hold) is a time, not a "1 set": it takes the time it already has on another day of the program, else 60 seconds. What the coach typed, and a
// time or set count the model itself wrote, are never changed.
export function applyTimedConsistency<T extends DayRow & { coachNamed?: boolean }>(rows: T[], known: Map<string, number>): T[] {
  return rows.map((r) => {
    if (r.coachNamed || !isTimedName(r.exerciseName)) return r;
    if (r.timeSeconds != null) return r;
    const prior = known.get(ruleKey(r.exerciseName));
    return { ...r, timeSeconds: prior ?? 60, reps: null };
  });
}

// ---- plain library names ----

const DECORATION = new Set(["bicep", "biceps", "tricep", "triceps"]);
const GRIP_BRACKET = /\s*\((?:[^)]*\b(?:grip|supinated|pronated|neutral)\b[^)]*)\)\s*$/i;

function singularWord(w: string): string {
  return w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
}

// "Dumbbell Bicep Curls (Supinated Grip)" -> the library's plain "Dumbbell Curl" when the library has it. Only a grip bracket, bicep/tricep filler and a plural are dropped; a real variant name is never changed.
export function plainLibraryName(name: string, libraryNames: string[]): string {
  if (!GRIP_BRACKET.test(name) && !/\b(bicep|biceps|tricep|triceps)\b/i.test(name) && !/s$/i.test(name.trim())) return name;
  const byKey = new Map(libraryNames.map((n) => [ruleKey(n), n]));
  const stripped = name.replace(GRIP_BRACKET, "").trim();
  const words = stripped.split(/\s+/);
  const variants = [
    words,
    words.filter((w) => !DECORATION.has(w.toLowerCase())),
    words.filter((w) => !DECORATION.has(w.toLowerCase())).map(singularWord),
    words.map(singularWord),
  ];
  for (const v of variants) {
    const hit = byKey.get(ruleKey(v.join(" ")));
    if (hit && ruleKey(hit) !== ruleKey(name)) return hit;
  }
  return name;
}

// ---- how long a day is ----

export const MAX_SENSIBLE_DAY = 10;

// "10 exercises a day", "12 exercises per session": a number of exercises the coach asked for. His number wins over the usual 5 to 8.
export function exercisesWanted(text: string): number | null {
  const m = /\b(\d{1,2})\s*(?:-|to)?\s*(?:\d{1,2}\s*)?exercises?\b/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 14 ? n : null;
}

export function longDayFlag(week: number, day: number, count: number, wanted: number | null = null): string | null {
  return count > Math.max(MAX_SENSIBLE_DAY, wanted ?? 0) ? `Week ${week}, Day ${day} has ${count} exercises, which is a long day. Worth a look.` : null;
}

// ---- exercises the coach names are sacred ----
// When the coach's own request names a specific exercise ("right heel lift hemi bridge adductor rock back"), that exercise goes in EXACTLY as named, even when the library has nothing close: the library
// never replaces or renames it. An exercise the AI chose itself is snapped to the library only on a confident match (the same movement with the same implement, side and position); otherwise it stays as written.

const NEGATORS = /\b(no|not|never|without|avoid|skip|except|exclude|excluding|don'?t|dont|remove)\b/i;
const normWords = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// The coach named this exercise in their own words, and did not name it to leave it out ("no barbell back squat"). The model's own claim ("coachNamed") counts only when the coach's text really contains the
// exercise: every word of its name is there (a plural counts), and none of those words follows a leave-out word. A claim the text does not back up is ignored, so the safety checks still apply.
const singular = (w: string) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
export function coachNamedExercise(request: string, name: string, aiMarked: boolean): boolean {
  const n = normWords(name);
  if (!n) return false;
  const words = n.split(" ");
  const textWords = new Set(normWords(request).split(" ").map(singular));
  const allThere = words.every((w) => textWords.has(singular(w)));
  if (!allThere) return false;
  // A leave-out word earlier in the same sentence as any word of the name (in either form) means the coach asked to avoid it.
  for (const clause of request.split(/[.;!?\n]+/)) {
    const c = ` ${normWords(clause)} `;
    for (const w of words) {
      for (const form of new Set([w, singular(w), `${singular(w)}s`])) {
        const at = c.indexOf(` ${form} `);
        if (at >= 0 && NEGATORS.test(c.slice(0, at + 1))) return false;
      }
    }
  }
  if (aiMarked) return true;
  // A long, specific name that appears word for word is the coach's even when the model forgot to say so.
  return words.length >= 3 && mentionsExercise(request, name);
}

export interface ResolvedName {
  name: string;
  coachNamed: boolean;
}

// The name a day-builder row is saved under. Coach-named: the coach's words, using the library's own spelling only when it is the very same exercise (identical name, an alias, or a spelling variant).
// AI-chosen: a library match is taken only when it is confident, then the plainest library name.
export function resolveAiExerciseName(
  e: { exerciseName: string; coachNamed?: boolean },
  request: string,
  library: { name: string }[],
  aliases: AliasEntry[],
  plain: (name: string) => string
): ResolvedName {
  const coachNamed = coachNamedExercise(request, e.exerciseName, e.coachNamed === true);
  const m = matchExercise(e.exerciseName, library, aliases);
  if (coachNamed) {
    const same = m.exerciseName && (m.confidence === "exact" || m.confidence === "alias");
    return { name: same ? (m.exerciseName as string) : e.exerciseName.trim(), coachNamed: true };
  }
  const confident = m.exerciseName && (m.confidence !== "fuzzy" || sameQualifiers(e.exerciseName, m.exerciseName));
  return { name: plain(confident ? (m.exerciseName as string) : e.exerciseName), coachNamed: false };
}
