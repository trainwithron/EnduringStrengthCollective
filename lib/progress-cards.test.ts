import { describe, it, expect } from "vitest";
import { MAIN_PATTERN_ORDER, defaultMetric, hasGraph, patternOfExerciseName, patternOfLadderName, planCards, seriesFor, summarizeExercises, type ExerciseSummary } from "@/lib/progress-cards";
import type { RollupRow } from "@/lib/imported-prs";

let n = 0;
const row = (day: string, exerciseName: string, bestWeight: number | null, extra: Partial<RollupRow> = {}): RollupRow => ({
  sessionId: extra.sessionId ?? `s${++n}`,
  at: `${day}T12:00:00.000Z`,
  exerciseName,
  bestWeight,
  bestE1rm: bestWeight == null ? null : Math.round(bestWeight * 1.2),
  volume: (bestWeight ?? 0) * 5,
  sets: 1,
  imported: false,
  hasLog: true,
  ...extra,
});
const logged = (name: string, times: number, weight = 100): RollupRow[] =>
  Array.from({ length: times }, (_, i) => row(`2026-0${(i % 9) + 1}-10`, name, weight + i));

describe("which pattern a ladder or an exercise is in", () => {
  it("the coach's ladder names", () => {
    expect(patternOfLadderName("Horizontal Push")).toBe("horizontal_press");
    expect(patternOfLadderName("Horizontal Press (bench)")).toBe("horizontal_press");
    expect(patternOfLadderName("Vertical Push")).toBe("vertical_press");
    expect(patternOfLadderName("Overhead press")).toBe("vertical_press");
    expect(patternOfLadderName("Horizontal Pull")).toBe("horizontal_pull");
    expect(patternOfLadderName("Rows")).toBe("horizontal_pull");
    expect(patternOfLadderName("Squat pattern")).toBe("squat");
    expect(patternOfLadderName("Hip Hinge")).toBe("hinge");
    expect(patternOfLadderName("Vertical Pull")).toBeNull();
    expect(patternOfLadderName("Core")).toBeNull();
  });
  it("plain exercise names, one-sided and vertical-pull moves excluded", () => {
    expect(patternOfExerciseName("Barbell Back Squat")).toBe("squat");
    expect(patternOfExerciseName("Trap Bar Deadlift")).toBe("hinge");
    expect(patternOfExerciseName("RDL")).toBe("hinge");
    expect(patternOfExerciseName("Barbell Bench Press")).toBe("horizontal_press");
    expect(patternOfExerciseName("Dumbbell Bench Press")).toBe("horizontal_press");
    expect(patternOfExerciseName("Overhead Press")).toBe("vertical_press");
    expect(patternOfExerciseName("Push Press")).toBe("vertical_press");
    expect(patternOfExerciseName("Seated Cable Row")).toBe("horizontal_pull");
    expect(patternOfExerciseName("Bulgarian Split Squat")).toBeNull();
    expect(patternOfExerciseName("Single Leg Deadlift")).toBeNull();
    expect(patternOfExerciseName("Upright Row")).toBeNull();
    expect(patternOfExerciseName("Cable Curl")).toBeNull();
    expect(patternOfExerciseName("Lat Pulldown")).toBeNull();
  });
});

describe("summaries", () => {
  it("one per exercise (names compared ignoring case), counting workouts, with both small graphs, a repeat day merged", () => {
    const rows = [row("2026-01-01", "Squat", 200), row("2026-02-01", "squat", 210), row("2026-02-01", "Squat", 215, { sessionId: "later" }), row("2026-02-05", "Squat", null)];
    const [s] = summarizeExercises(rows);
    expect(summarizeExercises(rows)).toHaveLength(1);
    expect(s.sessions).toBe(4);
    expect(s.bestWeight).toBe(215);
    expect(s.bestE1rm).toBe(258);
    expect(s.weightSeries).toEqual([
      { date: "2026-01-01", value: 200 },
      { date: "2026-02-01", value: 215 },
    ]);
    expect(s.volumeSeries.map((p) => p.date)).toEqual(["2026-01-01", "2026-02-01"]);
    expect(s.volumeSeries[1].value).toBe(210 * 5 + 215 * 5);
  });
});

describe("which cards, in what order", () => {
  const summaries = (rows: RollupRow[]) => summarizeExercises(rows);
  const big = [...logged("Back Squat", 6), ...logged("Trap Bar Deadlift", 5), ...logged("Bench Press", 7), ...logged("Overhead Press", 4), ...logged("Seated Row", 3), ...logged("Cable Curl", 9), ...logged("Cable Fly", 8)];

  it("the big five come first, one per pattern in the fixed order, however often a smaller lift was logged; a trap-bar deadlift is the hinge lift", () => {
    const plan = planCards(summaries(big), [], []);
    expect(plan.cards.slice(0, 5).map((c) => c.name)).toEqual(["Back Squat", "Bench Press", "Trap Bar Deadlift", "Overhead Press", "Seated Row"]);
    expect(plan.cards.slice(5).map((c) => c.name)).toEqual(["Cable Curl", "Cable Fly"]);
    expect(plan.patternCount).toBe(5);
    expect(plan.label).toBe("Your big five by most logged");
    expect(plan.visible).toBe(6);
  });
  it("within a pattern, the most logged exercise wins, and it adapts as the client logs more", () => {
    const rows = [...logged("Back Squat", 3), ...logged("Front Squat", 5), ...logged("Bench Press", 2)];
    expect(planCards(summaries(rows), [], []).cards[0].name).toBe("Front Squat");
    expect(planCards(summaries([...rows, ...logged("Back Squat", 4)]), [], []).cards[0].name).toBe("Back Squat");
  });
  it("a pattern the client has no lifts in has no card; a specialty client gets their most-logged exercises", () => {
    const plan = planCards(summaries([...logged("Kettlebell Swing", 6), ...logged("Farmer Carry", 4), ...logged("Battle Rope", 9)]), [], []);
    expect(plan.patternCount).toBe(0);
    expect(plan.cards.map((c) => c.name)).toEqual(["Battle Rope", "Kettlebell Swing", "Farmer Carry"]);
    expect(plan.label).toBe("Most logged");
  });
  it("the coach's ladders decide the pattern for exercises they cover, class A first", () => {
    const rows = [...logged("Landmine Press", 9), ...logged("Strict Press", 3), ...logged("Bench Press", 2)];
    const ladders = [{ patternName: "Vertical Push", exercises: [{ name: "Landmine Press", tier: "B" as const }, { name: "Strict Press", tier: "A" as const }] }];
    const plan = planCards(summaries(rows), ladders, []);
    // class A wins even though the landmine press was logged more
    expect(plan.cards.map((c) => c.name).slice(0, 2)).toEqual(["Bench Press", "Strict Press"]);
    const noClassA = planCards(summaries(rows), [{ patternName: "Vertical Push", exercises: [{ name: "Landmine Press", tier: null }, { name: "Strict Press", tier: null }] }], []);
    expect(noClassA.cards.map((c) => c.name).slice(0, 2)).toEqual(["Bench Press", "Landmine Press"]);
  });
  it("pins come first, in the order pinned, and the same exercise is not shown twice; a pin with nothing logged still has its card", () => {
    const plan = planCards(summaries(big), [], ["Cable Fly", "back squat", "Pause Bench"]);
    expect(plan.cards.slice(0, 3).map((c) => c.name)).toEqual(["Cable Fly", "Back Squat", "Pause Bench"]);
    expect(plan.cards.filter((c) => c.name.toLowerCase() === "back squat")).toHaveLength(1);
    expect(plan.cards[2].sessions).toBe(0);
    expect(plan.pinnedCount).toBe(3);
    expect(plan.label).toBe("Pinned first, then your big five by most logged");
    expect(planCards(summaries([...logged("Kettlebell Swing", 2)]), [], ["Kettlebell Swing"]).label).toBe("Pinned first, then most logged");
  });
  it("six cards show by default, or all the pins if there are more", () => {
    const many = Array.from({ length: 12 }, (_, i) => logged(`Exercise ${i}`, 12 - i)).flat();
    expect(planCards(summaries(many), [], []).visible).toBe(6);
    expect(planCards(summaries(many), [], ["a", "b", "c", "d", "e", "f", "g", "h"]).visible).toBe(8);
    expect(planCards([], [], []).visible).toBe(0);
  });
  it("the five patterns, in the order the cards use", () => {
    expect(MAIN_PATTERN_ORDER).toEqual(["squat", "horizontal_press", "hinge", "vertical_press", "horizontal_pull"]);
  });
});

describe("the graph", () => {
  const s = (weightSeries: ExerciseSummary["weightSeries"]): ExerciseSummary => ({ name: "x", sessions: weightSeries.length, lastAt: "", bestE1rm: null, bestWeight: null, weightSeries, volumeSeries: [{ date: "a", value: 1 }] });
  it("hypertrophy starts on volume, anything else on weight, and a saved choice wins", () => {
    expect(defaultMetric("Hypertrophy", null)).toBe("volume");
    expect(defaultMetric("hypertrophy / bodybuilding", undefined)).toBe("volume");
    expect(defaultMetric("Powerlifting/Strength", null)).toBe("weight");
    expect(defaultMetric(null, null)).toBe("weight");
    expect(defaultMetric("Hypertrophy", "weight")).toBe("weight");
    expect(defaultMetric("Strength", "volume")).toBe("volume");
  });
  it("a card with fewer than two days shows only the number", () => {
    expect(hasGraph([])).toBe(false);
    expect(hasGraph([{ date: "2026-01-01", value: 1 }])).toBe(false);
    expect(hasGraph([{ date: "2026-01-01", value: 1 }, { date: "2026-01-02", value: 2 }])).toBe(true);
  });
  it("the metric picks the series", () => {
    const one = s([{ date: "d", value: 5 }]);
    expect(seriesFor(one, "weight")).toBe(one.weightSeries);
    expect(seriesFor(one, "volume")).toBe(one.volumeSeries);
  });
});
