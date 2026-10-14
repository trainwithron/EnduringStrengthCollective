// Small, pure rules the AI Program Builder applies to the day it just wrote (and tells the model before it writes): no repeated exercise in a day, how many mobility days a week, timed work
// written the same way every day, plain library names, and a sensible day length. Pure, so each is tested.

import { matchExercise, sameQualifiers, type AliasEntry } from "@/lib/exercise-matching";
import { mentionsExercise } from "@/lib/builder-context";

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
export function mobilityDaysWanted(text: string): number | null {
  const t = text.toLowerCase();
  const word = "(\\d|one|two|three|four|five)";
  const a = new RegExp(`${word}\\s+(?:of\\s+(?:the\\s+|my\\s+)?)?(?:days?|sessions?|workouts?)\\b[^.\\n]{0,40}?\\bmobility\\b`).exec(t);
  const b = new RegExp(`${word}\\s+mobility\\s+(?:days?|sessions?|workouts?)\\b`).exec(t);
  const m = a ?? b;
  if (!m) return null;
  const n = NUM[m[1]] ?? Number(m[1]);
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : null;
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

export function isMobilityTitle(title: string): boolean {
  return /\bmobility\b/i.test(title);
}

export function mobilityInstruction(role: MobilityRole, wanted: number | null): string | null {
  if (wanted == null || role === "free") return null;
  if (role === "must") return `This week has ${wanted} mobility day${wanted === 1 ? "" : "s"}, and this is one of them: build a mobility day (mostly mobility, joint-range and stretching work, no heavy lifting) and call it "Mobility".`;
  return `This week already has its ${wanted} mobility day${wanted === 1 ? "" : "s"}: this is NOT a mobility day.`;
}

// ---- timed work is written the same way every day ----

const TIMED_NAME = /\b(foam roll(?:ing)?|stretch(?:es)?|hold|holds|plank|breathing|couch stretch|hang|dead hang|isometric|iso hold)\b/i;

export function isTimedName(name: string): boolean {
  return TIMED_NAME.test(name);
}

// A timed item (foam rolling, a stretch, a hold) is a time, not a "1 set": it reuses the time it already has on another day of the program, else the time the model gave, else 60 seconds.
export function applyTimedConsistency<T extends DayRow>(rows: T[], known: Map<string, number>): T[] {
  return rows.map((r) => {
    if (!isTimedName(r.exerciseName)) return r;
    const prior = known.get(ruleKey(r.exerciseName));
    const time = prior ?? r.timeSeconds ?? 60;
    return { ...r, timeSeconds: time, reps: null, sets: prior != null && r.sets > 1 ? 1 : r.sets };
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
