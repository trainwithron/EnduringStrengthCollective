import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadNutritionWeek, MAX_ROWS, statusFor, summarizeWeek, type FoodRow, type WeekClient } from "./coach-nutrition-week";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const client = (id: string, name = id, groupId = "g"): WeekClient => ({ id, groupId, fullName: name });
const food = (athlete: string, day: string, calories: number, protein = 0, status: string | null = null): FoodRow => ({ athlete_id: athlete, log_date: day, status, calories, protein_g: protein });
const base = { weights: [], targets: new Map(), trackingOff: new Set<string>(), suggestionsOff: new Set<string>(), weightUnits: new Map<string, "lb" | "kg">() };

describe("where a client's week stands", () => {
  it("on track within 10% of the target, over and under beyond it, with the gap", () => {
    expect(statusFor({ trackingOff: false, targetCalories: 2000, daysLogged: 5, avgCalories: 2100 })).toEqual({ status: "on_track", gapPct: 5 });
    expect(statusFor({ trackingOff: false, targetCalories: 2000, daysLogged: 5, avgCalories: 1500 })).toEqual({ status: "under", gapPct: -25 });
    expect(statusFor({ trackingOff: false, targetCalories: 2000, daysLogged: 5, avgCalories: 2600 })).toEqual({ status: "over", gapPct: 30 });
  });

  it("says plainly when there is nothing to compare: no target, tracking off, nothing logged", () => {
    expect(statusFor({ trackingOff: true, targetCalories: 2000, daysLogged: 0, avgCalories: null }).status).toBe("tracking_off");
    expect(statusFor({ trackingOff: false, targetCalories: null, daysLogged: 4, avgCalories: 1800 }).status).toBe("no_target");
    expect(statusFor({ trackingOff: false, targetCalories: 2000, daysLogged: 0, avgCalories: null }).status).toBe("nothing_logged");
  });
});

describe("the week's table", () => {
  it("averages the days they logged (not seven), counts a skipped meal as not logged, and puts those who need the coach first", () => {
    const rows = summarizeWeek({
      ...base,
      clients: [client("a", "Ann"), client("b", "Bo"), client("c", "Cy")],
      food: [
        food("a", "2026-10-12", 1000, 80),
        food("a", "2026-10-12", 1000, 80), // same day: 2000 for the day
        food("a", "2026-10-13", 2000, 120),
        food("b", "2026-10-12", 1200),
        food("b", "2026-10-13", 500, 0, "skipped"), // a skipped meal is not food
      ],
      targets: new Map([
        ["a", { calories: 2000, proteinG: 160 }],
        ["b", { calories: 2000, proteinG: 150 }],
        ["c", { calories: 2000, proteinG: 150 }],
      ]),
    });
    expect(rows.map((r) => [r.fullName, r.status])).toEqual([["Cy", "nothing_logged"], ["Bo", "under"], ["Ann", "on_track"]]);
    const ann = rows.find((r) => r.id === "a")!;
    expect(ann).toMatchObject({ daysLogged: 2, avgCalories: 2000, avgProteinG: 140, targetCalories: 2000, targetProteinG: 160 });
    expect(rows.find((r) => r.id === "b")).toMatchObject({ daysLogged: 1, avgCalories: 1200, calorieGapPct: -40 });
  });

  it("shows the weight change in the client's own unit (stored in pounds), and nothing for a single weigh-in", () => {
    const rows = summarizeWeek({
      ...base,
      clients: [client("a", "Ann"), client("b", "Bo"), client("c", "Cy")],
      food: [],
      weights: [
        { athlete_id: "a", logged_date: "2026-10-12", weight: 200 },
        { athlete_id: "a", logged_date: "2026-10-17", weight: 198 },
        { athlete_id: "b", logged_date: "2026-10-12", weight: 220 },
        { athlete_id: "b", logged_date: "2026-10-17", weight: 215 },
        { athlete_id: "c", logged_date: "2026-10-12", weight: 150 },
      ],
      weightUnits: new Map([["b", "kg" as const]]),
    });
    expect(rows.find((r) => r.id === "a")).toMatchObject({ weightChange: -2, weightUnit: "lb" });
    expect(rows.find((r) => r.id === "b")).toMatchObject({ weightChange: -2.3, weightUnit: "kg" });
    expect(rows.find((r) => r.id === "c")!.weightChange).toBeNull();
  });

  it("marks a client whose automatic suggestions are off, by person or by group", () => {
    const rows = summarizeWeek({ ...base, clients: [client("a"), client("b", "b", "g2")], food: [], suggestionsOff: new Set(["a", "b|g2"]) });
    expect(rows.every((r) => r.suggestionsOff)).toBe(true);
    expect(summarizeWeek({ ...base, clients: [client("a")], food: [], suggestionsOff: new Set(["a|other"]) })[0].suggestionsOff).toBe(false);
  });
});

// A stand-in database where every table answers with the rows it was given, whatever the filters.
function fakeDb(tables: Record<string, unknown[]>, failing: string[] = []) {
  return {
    from(table: string) {
      const q: any = {
        select: () => q,
        in: () => q,
        eq: () => q,
        gte: () => q,
        lte: () => q,
        order: () => q,
        range: () => q,
        then(resolve: (v: unknown) => void) {
          if (failing.includes(table)) return resolve({ data: null, error: { message: "x" } });
          return resolve({ data: tables[table] ?? [], error: null });
        },
      };
      return q;
    },
  } as any;
}

describe("loading the week", () => {
  it("a failed read is reported as failed, never shown as clients who logged nothing", async () => {
    const w = await loadNutritionWeek(fakeDb({}, ["food_log_entries"]), [client("a")], "2026-10-17");
    expect(w.failed).toBe(true);
    expect(w.rows).toEqual([]);
  });

  it("puts the reads together", async () => {
    const db = fakeDb({
      food_log_entries: [{ id: "1", athlete_id: "a", log_date: "2026-10-16", status: null, calories: 1800, protein_g: 120 }],
      client_macro_target_history: [{ athlete_id: "a", group_id: "g", effective_from: "2026-01-01", calories: 2000, protein_g: 150, carbs_g: 200, fat_g: 60 }],
      group_memberships: [{ id: "m", profile_id: "a", group_id: "g", food_tracking_enabled: true, coach_sets_macros: null }],
      client_nutrition_flags: [{ profile_id: "a", group_id: "g" }],
    });
    const w = await loadNutritionWeek(db, [client("a", "Ann")], "2026-10-17");
    expect(w.failed).toBe(false);
    expect(w.rows[0]).toMatchObject({ fullName: "Ann", status: "on_track", daysLogged: 1, avgCalories: 1800, targetCalories: 2000, suggestionsOff: true });
  });

  it("caps the table and says how many there are", async () => {
    const clients = Array.from({ length: MAX_ROWS + 25 }, (_, i) => client(`c${i}`, `Client ${String(i).padStart(3, "0")}`));
    const w = await loadNutritionWeek(fakeDb({}), clients, "2026-10-17");
    expect(w.rows).toHaveLength(MAX_ROWS);
    expect(w.total).toBe(MAX_ROWS + 25);
  });
});

describe("how it is wired", () => {
  it("is a fourth tab on the coach Nutrition page, read only, and the section says plainly when it could not load", () => {
    const page = src("app/(coach)/groups/[groupId]/nutrition/page.tsx");
    expect(page).toContain('{ key: "week", label: "This week" }');
    expect(page).toContain("<WeeklyNutritionSection");
    const section = src("components/coach/nutrition/weekly-nutrition-section.tsx");
    expect(section).toContain("nothing is shown rather than a table that could be wrong");
    expect(section).not.toMatch(/\.(insert|update|delete|upsert)\(/);
    expect(src("lib/coach-nutrition-week.ts")).not.toMatch(/\.(insert|update|delete|upsert)\(/);
  });
});
