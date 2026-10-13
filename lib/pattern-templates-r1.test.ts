import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CORE_PATTERN_NAMES, PATTERN_NAMES, STARTER_PATTERNS, STARTER_RUNGS, buildRungInserts, planStarterAdd, starterResultLine } from "@/lib/starter-ladders";
import { NO_FILTERS, matchesFilters, patternFilterOptions, tagChip } from "@/lib/library-sort";
import { looksUnilateral, parseSuggestions, rankForLevel, unsortedNames } from "@/lib/pattern-sort";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("Ron's taxonomy and the starter ladders", () => {
  it("his ten patterns, then the extras", () => {
    expect(CORE_PATTERN_NAMES).toEqual(["Hinge", "Squat", "Vertical Press", "Vertical Pull", "Horizontal Press", "Horizontal Pull", "Core: Rotation", "Core: Anti-rotation", "Core: Flexion", "Core: Extension"]);
    expect(PATTERN_NAMES.slice(10)).toEqual(["Core: Stability", "Loaded Carry", "Elbow Flexion (Biceps)", "Elbow Extension (Triceps)"]);
  });
  it("every pattern has a ladder, no exercise is on a ladder twice, every class is A, B or C", () => {
    for (const p of PATTERN_NAMES) {
      const rungs = STARTER_RUNGS.filter((r) => r.pattern === p);
      expect(rungs.length, p).toBeGreaterThanOrEqual(4);
      expect(new Set(rungs.map((r) => r.exercise.toLowerCase())).size, p).toBe(rungs.length);
      for (const r of rungs) expect(["A", "B", "C"]).toContain(r.tier);
    }
    expect(STARTER_RUNGS.every((r) => STARTER_PATTERNS.some((p) => p.name === r.pattern))).toBe(true);
  });
  it("each of the six base patterns has a unilateral version (a lunge is the unilateral squat), in the same pattern", () => {
    for (const p of ["Hinge", "Squat", "Vertical Press", "Vertical Pull", "Horizontal Press", "Horizontal Pull"]) {
      expect(STARTER_RUNGS.some((r) => r.pattern === p && r.unilateral), p).toBe(true);
      expect(STARTER_RUNGS.some((r) => r.pattern === p && !r.unilateral), p).toBe(true);
    }
    expect(STARTER_RUNGS.find((r) => r.exercise === "Bulgarian Split Squat")).toMatchObject({ pattern: "Squat", unilateral: true });
  });
  it("Ron's example slots all have something to pick: class A bilateral hinge, class A horizontal press, class B horizontal pull, class C biceps", () => {
    const has = (pattern: string, tier: string, uni = false) => STARTER_RUNGS.some((r) => r.pattern === pattern && r.tier === tier && r.unilateral === uni);
    expect(has("Hinge", "A")).toBe(true);
    expect(has("Horizontal Press", "A")).toBe(true);
    expect(has("Horizontal Pull", "B")).toBe(true);
    expect(has("Elbow Flexion (Biceps)", "C")).toBe(true);
  });
  it("his squat ladder includes a bodyweight squat, a goblet squat and a barbell back squat", () => {
    const squat = STARTER_RUNGS.filter((r) => r.pattern === "Squat" && !r.unilateral).sort((a, b) => a.rank - b.rank);
    expect(squat[0].exercise).toBe("Bodyweight Squat");
    expect(squat.map((r) => r.exercise)).toEqual(expect.arrayContaining(["Goblet Squat", "Front Squat", "Back Squat"]));
  });
});

describe("Add the starter ladders", () => {
  it("a coach with nothing gets every ladder", () => {
    const plan = planStarterAdd([]);
    expect(plan.newPatterns).toHaveLength(14);
    expect(plan.exerciseCount).toBe(STARTER_RUNGS.length);
    expect(starterResultLine(plan)).toBe(`Added 14 ladders and ${STARTER_RUNGS.length} exercises.`);
  });
  it("a coach who has it all gets told so, and nothing is added", () => {
    const all = STARTER_PATTERNS.map((p) => ({ id: p.name, name: p.name, exerciseNames: STARTER_RUNGS.filter((r) => r.pattern === p.name).map((r) => r.exercise) }));
    const plan = planStarterAdd(all);
    expect(plan.exerciseCount).toBe(0);
    expect(starterResultLine(plan)).toBe("You already have all the starter ladders.");
  });
  it("a ladder the coach has keeps everything: only missing exercises are added, after the last one", () => {
    const plan = planStarterAdd([{ id: "p1", name: "Squat", exerciseNames: ["Goblet Squat", "My Own Squat"] }]);
    expect(plan.newPatterns.some((p) => p.name === "Squat")).toBe(false);
    const squat = plan.rungs.find((g) => g.pattern === "Squat")!;
    expect(squat.rungs.some((r) => r.exercise === "Goblet Squat")).toBe(false);
    const inserts = buildRungInserts(plan, new Map([["Squat", "p1"]]), new Map([["Squat", 9]]));
    const squatInserts = inserts.filter((i) => i.movement_pattern_id === "p1");
    expect(Math.min(...squatInserts.map((i) => i.difficulty_rank))).toBe(10);
    expect(squatInserts.find((i) => i.exercise_name === "Bulgarian Split Squat")?.is_unilateral).toBe(true);
  });
});

describe("sorting the library by pattern, side and class", () => {
  const hingeUniA = { pattern: "Hinge", unilateral: true, tier: "A" as const };
  const squatBilB = { pattern: "Squat", unilateral: false, tier: "B" as const };
  const unsorted = { pattern: null, unilateral: false, tier: null };
  it("filters by each dial and by all three together", () => {
    expect(matchesFilters(hingeUniA, { ...NO_FILTERS, pattern: "Hinge" })).toBe(true);
    expect(matchesFilters(squatBilB, { ...NO_FILTERS, pattern: "Hinge" })).toBe(false);
    expect(matchesFilters(hingeUniA, { ...NO_FILTERS, side: "unilateral" })).toBe(true);
    expect(matchesFilters(squatBilB, { ...NO_FILTERS, side: "unilateral" })).toBe(false);
    expect(matchesFilters(squatBilB, { ...NO_FILTERS, side: "bilateral" })).toBe(true);
    expect(matchesFilters(hingeUniA, { pattern: "Hinge", side: "unilateral", tier: "A" })).toBe(true);
    expect(matchesFilters(hingeUniA, { pattern: "Hinge", side: "unilateral", tier: "B" })).toBe(false);
  });
  it("an exercise that is not sorted yet shows with no filter and never under a filter", () => {
    expect(matchesFilters(unsorted, NO_FILTERS)).toBe(true);
    expect(matchesFilters(unsorted, { ...NO_FILTERS, side: "bilateral" })).toBe(false);
  });
  it("the row chip reads Pattern, Side, Class", () => {
    expect(tagChip(hingeUniA)).toBe("Hinge · Unilateral · Class A");
    expect(tagChip(squatBilB)).toBe("Squat · Bilateral · Class B");
    expect(tagChip(unsorted)).toBeNull();
  });
  it("the pattern list shows his ten first, in his order", () => {
    expect(patternFilterOptions(["Loaded Carry", "Squat", "My Own", "Hinge"], PATTERN_NAMES)).toEqual(["Hinge", "Squat", "Loaded Carry", "My Own"]);
  });
  it("the library page and list are wired to it", () => {
    const list = read("components/coach/exercise-library-list.tsx");
    for (const t of ["Pattern", "Side", "Class", "Clear filters", "No exercises match. Clear a filter."]) expect(list).toContain(t);
    expect(read("app/(coach)/groups/[groupId]/exercise-library/page.tsx")).toContain("is_unilateral");
  });
});

describe("Sort my exercises", () => {
  it("names that say one side at a time are unilateral by rule", () => {
    for (const n of ["Single Leg Romanian Deadlift", "Bulgarian Split Squat", "Dumbbell Walking Lunge", "Single-Arm DB Row", "Step Up", "One Arm Row"]) expect(looksUnilateral(n), n).toBe(true);
    for (const n of ["Back Squat", "Bench Press", "Lat Pulldown"]) expect(looksUnilateral(n), n).toBe(false);
  });
  it("reads the suggestion safely: only names asked about, only patterns offered, level clamped, a bad class dropped", () => {
    const raw = [
      { name: "back squat", pattern: "Squat", unilateral: false, tier: "A", level: 9 },
      { name: "Made Up", pattern: "Squat", unilateral: false, tier: "A", level: 3 },
      { name: "Jump Rope", pattern: "Not A Pattern", unilateral: false, tier: "Z", level: "x" },
      { name: "Back Squat", pattern: "Hinge", unilateral: true, tier: "B", level: 1 },
    ];
    const out = parseSuggestions(raw, ["Back Squat", "Jump Rope"], ["Squat", "Hinge"]);
    expect(out.map((s) => s.name)).toEqual(["Back Squat", "Jump Rope"]);
    expect(out[0]).toMatchObject({ pattern: "Squat", tier: "A", level: 5, unilateral: false });
    expect(out[1]).toMatchObject({ pattern: null, tier: null, level: 3 });
    expect(parseSuggestions("nope", ["x"], [])).toEqual([]);
  });
  it("a level 1 to 5 lands across the ladder it joins", () => {
    expect(rankForLevel(1, [0, 4, 8])).toBe(0);
    expect(rankForLevel(3, [0, 4, 8])).toBe(4);
    expect(rankForLevel(5, [0, 4, 8])).toBe(8);
    expect(rankForLevel(1, [])).toBe(0);
    expect(rankForLevel(5, [])).toBe(4);
  });
  it("only exercises on no ladder and not skipped are left to sort", () => {
    expect(unsortedNames(["A", "B", "C"], new Set(["A"]), new Set(["B"]))).toEqual(["C"]);
  });
  it("the screen has the agreed words, and the route is coach-only and writes nothing", () => {
    const ui = read("components/coach/sort-my-exercises.tsx");
    for (const t of ["Sort my exercises", "Tag each exercise with its pattern, side and class so templates can pick from them. Nothing is saved until you confirm.", "Confirm all shown", "Everything is sorted.", "Couldn't suggest right now. You can still pick by hand.", "Level 1 (easy) to 5 (hard)"]) expect(ui).toContain(t);
    const route = read("app/api/ai/suggest-patterns/route.ts");
    expect(route).toContain('eq("role", "coach")');
    expect(route).not.toContain(".insert(");
    expect(route).not.toContain(".upsert(");
  });
});

describe("the ladder editor keeps the one-sided mark", () => {
  it("saving a ladder writes is_unilateral, and each exercise has a Unilateral toggle", () => {
    const row = read("components/coach/movement-pattern-row.tsx");
    expect(row).toContain("is_unilateral: !!item.unilateral");
    expect(row).toContain('aria-label="Unilateral"');
  });
  it("the migration only adds columns", () => {
    const sql = read("supabase/migrations/0365_pattern_class_templates.sql");
    expect(sql).toContain("add column if not exists is_unilateral boolean not null default false");
    expect(sql).not.toMatch(/\b(drop|delete|update) /i);
  });
});
