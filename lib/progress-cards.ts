// The Progress tab's exercise cards (release CC). Which exercises get a card, in what order, and what each card's small graph shows. Pure, so every rule is tested.
//
// The order is predictable: the coach's PINS first (their own choice for this client), then the client's BIG FIVE, one lift per main pattern (squat, bench-type press, hinge, overhead-type press,
// row-type pull), each the exercise the client has logged most in that pattern (so a trap-bar deadlift is the hinge lift, not found by name); then everything else, most logged first. A pattern the
// client has no lifts in simply has no card. A client with none of the big five (a specialty client) gets their most-logged exercises. The pattern of an exercise is read from the coach's own
// movement-pattern ladders when the exercise is in one (class A preferred), else from plain words in its name.
import { exerciseKey } from "@/lib/exercise-matching";
import type { RollupRow } from "@/lib/imported-prs";

export type MainPattern = "squat" | "horizontal_press" | "hinge" | "vertical_press" | "horizontal_pull";
export const MAIN_PATTERN_ORDER: MainPattern[] = ["squat", "horizontal_press", "hinge", "vertical_press", "horizontal_pull"];
export const DEFAULT_VISIBLE_CARDS = 6;

export type Metric = "weight" | "volume";

export interface SeriesPoint {
  date: string;
  value: number;
}

export interface ExerciseSummary {
  name: string;
  sessions: number;
  lastAt: string;
  bestE1rm: number | null;
  bestWeight: number | null;
  weightSeries: SeriesPoint[];
  volumeSeries: SeriesPoint[];
}

export interface LadderInput {
  patternName: string;
  exercises: { name: string; tier: "A" | "B" | "C" | null }[];
}

const words = (text: string): string[] => text.toLowerCase().split(/[^a-z]+/).filter(Boolean);

// A coach's ladder name ("Horizontal Push", "Squat Pattern", "Hip Hinge") -> one of the five main patterns, or null for any other.
export function patternOfLadderName(name: string): MainPattern | null {
  const w = words(name);
  const has = (...candidates: string[]) => candidates.some((c) => w.includes(c));
  if (has("horizontal") && has("pull", "row", "rows")) return "horizontal_pull";
  if (has("horizontal") && has("push", "press")) return "horizontal_press";
  if (has("vertical") && has("push", "press")) return "vertical_press";
  if (has("vertical") && has("pull")) return null;
  if (has("squat", "squats")) return "squat";
  if (has("hinge", "deadlift")) return "hinge";
  if (has("row", "rows")) return "horizontal_pull";
  if (has("bench")) return "horizontal_press";
  if (has("overhead")) return "vertical_press";
  return null;
}

const ONE_SIDED = ["split", "lunge", "lunges", "bulgarian", "pistol", "single", "step", "stepup"];

// An exercise name -> the main pattern, by its words, for an exercise that is in none of the coach's ladders.
export function patternOfExerciseName(name: string): MainPattern | null {
  const w = words(name);
  const has = (...candidates: string[]) => candidates.some((c) => w.includes(c));
  const oneSided = has(...ONE_SIDED) || (has("one") && has("leg", "arm"));
  if (has("upright")) return null;
  if (has("row", "rows")) return oneSided ? null : "horizontal_pull";
  if (has("squat", "squats")) return oneSided ? null : "squat";
  if (has("deadlift", "deadlifts", "rdl", "romanian")) return oneSided ? null : "hinge";
  if (has("bench")) return oneSided ? null : "horizontal_press";
  if (has("overhead", "ohp", "military") || (has("shoulder") && has("press")) || (has("push") && has("press"))) return oneSided ? null : "vertical_press";
  return null;
}

interface LadderEntry {
  pattern: MainPattern;
  tier: "A" | "B" | "C" | null;
}

function ladderIndex(ladders: LadderInput[]): Map<string, LadderEntry> {
  const index = new Map<string, LadderEntry>();
  for (const ladder of ladders) {
    const pattern = patternOfLadderName(ladder.patternName);
    if (!pattern) continue;
    for (const ex of ladder.exercises) {
      const key = exerciseKey(ex.name);
      if (key && !index.has(key)) index.set(key, { pattern, tier: ex.tier });
    }
  }
  return index;
}

// One summary per exercise from the rolled-up rows: sessions, last date, best weight and best estimated max, and the two small graphs (best weight per day, volume per day).
export function summarizeExercises(rows: RollupRow[]): ExerciseSummary[] {
  const byKey = new Map<string, { name: string; nameAt: string; rows: RollupRow[] }>();
  for (const row of rows) {
    const key = row.exerciseName.trim().toLowerCase();
    const entry = byKey.get(key) ?? { name: row.exerciseName, nameAt: row.at, rows: [] };
    if (new Date(row.at).getTime() > new Date(entry.nameAt).getTime()) {
      entry.name = row.exerciseName;
      entry.nameAt = row.at;
    }
    entry.rows.push(row);
    byKey.set(key, entry);
  }
  const out: ExerciseSummary[] = [];
  for (const entry of byKey.values()) {
    const weightByDay = new Map<string, number>();
    const volumeByDay = new Map<string, number>();
    let bestE1rm: number | null = null;
    let bestWeight: number | null = null;
    let lastAt = entry.rows[0].at;
    for (const r of entry.rows) {
      const day = r.at.slice(0, 10);
      if (r.bestWeight != null && r.bestWeight > 0) {
        weightByDay.set(day, Math.max(weightByDay.get(day) ?? 0, r.bestWeight));
        bestWeight = Math.max(bestWeight ?? 0, r.bestWeight);
      }
      if (r.volume > 0) volumeByDay.set(day, (volumeByDay.get(day) ?? 0) + r.volume);
      if (r.bestE1rm != null) bestE1rm = Math.max(bestE1rm ?? 0, r.bestE1rm);
      if (new Date(r.at).getTime() > new Date(lastAt).getTime()) lastAt = r.at;
    }
    const toSeries = (m: Map<string, number>): SeriesPoint[] =>
      Array.from(m.entries())
        .map(([date, value]) => ({ date, value }))
        .sort((a, b) => a.date.localeCompare(b.date));
    out.push({
      name: entry.name,
      sessions: new Set(entry.rows.map((r) => r.sessionId)).size,
      lastAt,
      bestE1rm,
      bestWeight,
      weightSeries: toSeries(weightByDay),
      volumeSeries: toSeries(volumeByDay),
    });
  }
  return out;
}

export interface CardPlan {
  cards: ExerciseSummary[]; // every exercise, in card order
  pinnedCount: number;
  patternCount: number; // how many of the big five were found
  visible: number; // how many show before Show all
  label: string; // what the cards are showing, in plain words
}

const byMostLogged = (a: ExerciseSummary, b: ExerciseSummary) =>
  b.sessions - a.sessions || (b.bestE1rm ?? 0) - (a.bestE1rm ?? 0) || b.lastAt.localeCompare(a.lastAt) || a.name.localeCompare(b.name);

export function planCards(summaries: ExerciseSummary[], ladders: LadderInput[], pinned: string[]): CardPlan {
  const index = ladderIndex(ladders);
  const patternOf = (s: ExerciseSummary): { pattern: MainPattern; tier: "A" | "B" | "C" | null } | null => {
    const fromLadder = index.get(exerciseKey(s.name));
    if (fromLadder) return fromLadder;
    const byName = patternOfExerciseName(s.name);
    return byName ? { pattern: byName, tier: null } : null;
  };

  const used = new Set<string>();
  const taken = (s: ExerciseSummary) => used.has(s.name.trim().toLowerCase());
  const mark = (s: ExerciseSummary) => used.add(s.name.trim().toLowerCase());

  const lookup = new Map(summaries.map((s) => [s.name.trim().toLowerCase(), s]));
  const pinCards: ExerciseSummary[] = [];
  for (const name of pinned) {
    const key = name.trim().toLowerCase();
    if (used.has(key)) continue;
    // A pinned exercise with nothing logged yet still gets its card, so the pin is never silently lost.
    const found = lookup.get(key) ?? { name, sessions: 0, lastAt: "", bestE1rm: null, bestWeight: null, weightSeries: [], volumeSeries: [] };
    pinCards.push(found);
    used.add(key);
  }

  const patternCards: ExerciseSummary[] = [];
  for (const pattern of MAIN_PATTERN_ORDER) {
    const candidates = summaries
      .filter((s) => !taken(s) && s.sessions > 0)
      .map((s) => ({ s, p: patternOf(s) }))
      .filter((c) => c.p?.pattern === pattern);
    if (candidates.length === 0) continue;
    const classA = candidates.filter((c) => c.p?.tier === "A");
    const pool = (classA.length > 0 ? classA : candidates).map((c) => c.s).sort(byMostLogged);
    patternCards.push(pool[0]);
    mark(pool[0]);
  }

  const rest = summaries.filter((s) => !taken(s)).sort(byMostLogged);
  const cards = [...pinCards, ...patternCards, ...rest];
  const label =
    pinCards.length > 0 && patternCards.length > 0
      ? "Pinned first, then your big five by most logged"
      : pinCards.length > 0
        ? "Pinned first, then most logged"
        : patternCards.length > 0
          ? "Your big five by most logged"
          : "Most logged";
  return {
    cards,
    pinnedCount: pinCards.length,
    patternCount: patternCards.length,
    visible: Math.min(cards.length, Math.max(DEFAULT_VISIBLE_CARDS, pinCards.length)),
    label,
  };
}

// The graph each card starts on: a program whose training intent is hypertrophy starts on volume; anything else (strength, powerlifting, no intent) on weight. The coach's own saved choice wins.
export function defaultMetric(trainingIntent: string | null | undefined, saved: Metric | null | undefined): Metric {
  if (saved === "weight" || saved === "volume") return saved;
  return (trainingIntent ?? "").toLowerCase().includes("hypertrophy") ? "volume" : "weight";
}

// A card with fewer than two logged days shows just the number: no empty graph.
export function hasGraph(series: SeriesPoint[]): boolean {
  return series.length >= 2;
}

export function seriesFor(summary: ExerciseSummary, metric: Metric): SeriesPoint[] {
  return metric === "weight" ? summary.weightSeries : summary.volumeSeries;
}
