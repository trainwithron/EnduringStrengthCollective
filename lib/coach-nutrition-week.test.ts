import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadNutritionWeek, MAX_ROWS, statusFor, summarizeWeek, type FoodRow, type WeekClient } from "./coach-nutrition-week";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const client = (id: string, name = id, groupId = "g"): WeekClient => ({ id, groupId, fullName: name });
const food = (athlete: string, day: string, calories: number, protein = 0, status: string | null = null): FoodRow => ({ athlete_id: athlete, log_date: day, status, calories, protein_g: protein });
const base = { weights: [], targets: new Map<string, { calories: number | null; proteinG: number | null }>(), trackingOff: new Set<string>(), suggestionsOff: new Set<string>(), weightUnits: new Map<string, "lb" | "kg">() };
const adults = async () => new Set<string>();

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

  it("a client who is not judged is never called under or over and gets no percent", () => {
    expect(statusFor({ trackingOff: false, targetCalories: 2000, daysLogged: 5, avgCalories: 1000, neutral: true })).toEqual({ status: "logged", gapPct: null });
    expect(statusFor({ trackingOff: false, targetCalories: 2000, daysLogged: 5, avgCalories: 3500, neutral: true })).toEqual({ status: "logged", gapPct: null });
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
        ["a|g", { calories: 2000, proteinG: 160 }],
        ["b|g", { calories: 2000, proteinG: 150 }],
        ["c|g", { calories: 2000, proteinG: 150 }],
      ]),
    });
    expect(rows.map((r) => [r.fullName, r.status])).toEqual([["Cy", "nothing_logged"], ["Bo", "under"], ["Ann", "on_track"]]);
    expect(rows.find((r) => r.id === "a")).toMatchObject({ daysLogged: 2, avgCalories: 2000, avgProteinG: 140, targetCalories: 2000, targetProteinG: 160 });
    expect(rows.find((r) => r.id === "b")).toMatchObject({ daysLogged: 1, avgCalories: 1200, calorieGapPct: -40 });
  });

  it("a client's target is the one from THEIR group: a person in two groups never borrows the other's", () => {
    const rows = summarizeWeek({
      ...base,
      clients: [client("a", "Ann", "g1"), client("a", "Ann", "g2")],
      food: [food("a", "2026-10-12", 2000)],
      targets: new Map([["a|g1", { calories: 2000, proteinG: 150 }], ["a|g2", { calories: 3000, proteinG: 200 }]]),
    });
    expect(rows.find((r) => r.groupId === "g1")).toMatchObject({ targetCalories: 2000, status: "on_track" });
    expect(rows.find((r) => r.groupId === "g2")).toMatchObject({ targetCalories: 3000, status: "under" });
  });

  it("a client with automatic suggestions off, a minor or unknown age, and everyone when age could not be told, are shown only the days logged", () => {
    const rows = summarizeWeek({
      ...base,
      clients: [client("off", "Off"), client("kid", "Kid"), client("adult", "Adult")],
      food: [food("off", "2026-10-12", 900), food("kid", "2026-10-12", 900), food("adult", "2026-10-12", 900)],
      targets: new Map([["off|g", { calories: 2000, proteinG: 150 }], ["kid|g", { calories: 2000, proteinG: 150 }], ["adult|g", { calories: 2000, proteinG: 150 }]]),
      suggestionsOff: new Set(["off"]),
      protectedIds: new Set(["kid"]),
    });
    const by = (id: string) => rows.find((r) => r.id === id)!;
    expect(by("off")).toMatchObject({ status: "logged", calorieGapPct: null, neutral: true, suggestionsOff: true });
    expect(by("kid")).toMatchObject({ status: "logged", calorieGapPct: null, neutral: true });
    expect(by("adult")).toMatchObject({ status: "under", calorieGapPct: -55, neutral: false });
    const everyone = summarizeWeek({ ...base, clients: [client("adult")], food: [food("adult", "2026-10-12", 900)], targets: new Map([["adult|g", { calories: 2000, proteinG: 150 }]]), protectedIds: new Set(["*"]) });
    expect(everyone[0]).toMatchObject({ status: "logged", neutral: true });
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

// A stand-in database that pages like the real one: each table answers with its rows, cut to the requested range, whatever the filters.
function fakeDb(tables: Record<string, unknown[]>, failing: string[] | Record<string, { code?: string }> = []) {
  const errors: Record<string, { code?: string }> = Array.isArray(failing) ? Object.fromEntries(failing.map((t) => [t, {}])) : failing;
  return {
    from(table: string) {
      let range: [number, number] | null = null;
      const q: any = {
        select: () => q,
        in: () => q,
        eq: () => q,
        gte: () => q,
        lte: () => q,
        order: () => q,
        limit: () => q,
        range: (a: number, b: number) => ((range = [a, b]), q),
        then(resolve: (v: unknown) => void) {
          if (errors[table]) return resolve({ data: null, error: { message: "x", ...errors[table] } });
          const rows = tables[table] ?? [];
          return resolve({ data: range ? rows.slice(range[0], range[1] + 1) : rows, error: null });
        },
      };
      return q;
    },
  } as any;
}

describe("loading the week", () => {
  it("a failed read of any kind is reported as failed, never shown as clients who logged nothing or have no target", async () => {
    for (const table of ["food_log_entries", "body_weight_logs", "group_memberships", "athlete_profile_details", "client_macro_target_history", "client_macro_targets"]) {
      const w = await loadNutritionWeek(fakeDb({}, [table]), [client("a")], "2026-10-17", adults);
      expect(w.failed, table).toBe(true);
      expect(w.rows).toEqual([]);
    }
  });

  it("puts the reads together", async () => {
    const db = fakeDb({
      food_log_entries: [{ id: "1", athlete_id: "a", log_date: "2026-10-16", status: null, calories: 1800, protein_g: 120 }],
      client_macro_target_history: [{ athlete_id: "a", group_id: "g", effective_from: "2026-01-01", calories: 2000, protein_g: 150, carbs_g: 200, fat_g: 60 }],
      group_memberships: [{ id: "m", profile_id: "a", group_id: "g", food_tracking_enabled: true, coach_sets_macros: null }],
    });
    const w = await loadNutritionWeek(db, [client("a", "Ann")], "2026-10-17", adults);
    expect(w.failed).toBe(false);
    expect(w.rows[0]).toMatchObject({ fullName: "Ann", status: "on_track", daysLogged: 1, avgCalories: 1800, targetCalories: 2000, suggestionsOff: false });
  });

  it("if the safety switch cannot be read, nobody is judged: a flagged client is never shown as under or over, and the page is told", async () => {
    const tables = {
      food_log_entries: [{ id: "1", athlete_id: "a", log_date: "2026-10-16", status: null, calories: 900, protein_g: 50 }],
      client_macro_target_history: [{ athlete_id: "a", group_id: "g", effective_from: "2026-01-01", calories: 2000, protein_g: 150, carbs_g: 0, fat_g: 0 }],
    };
    const w = await loadNutritionWeek(fakeDb(tables, { client_nutrition_flags: {} }), [client("a", "Ann")], "2026-10-17", adults);
    expect(w.failed).toBe(false);
    expect(w.flagsUnreadable).toBe(true);
    expect(w.rows[0]).toMatchObject({ status: "logged", calorieGapPct: null, neutral: true });
  });

  it("a cut-short read of the switch (more rows than a read returns) also makes everyone neutral", async () => {
    const flags = Array.from({ length: 26_000 }, (_, i) => ({ profile_id: `p${i}`, group_id: "x" }));
    const tables = {
      food_log_entries: [{ id: "1", athlete_id: "a", log_date: "2026-10-16", status: null, calories: 900, protein_g: 50 }],
      client_macro_target_history: [{ athlete_id: "a", group_id: "g", effective_from: "2026-01-01", calories: 2000, protein_g: 150, carbs_g: 0, fat_g: 0 }],
      client_nutrition_flags: flags,
    };
    const w = await loadNutritionWeek(fakeDb(tables), [client("a", "Ann")], "2026-10-17", adults);
    expect(w.flagsUnreadable).toBe(true);
    expect(w.rows[0]).toMatchObject({ status: "logged", neutral: true });
  });

  it("only a MISSING flags table (the paste is pending) reads as nobody flagged: not neutral, unless No macros for that client is on", async () => {
    const tables = {
      food_log_entries: [{ id: "1", athlete_id: "a", log_date: "2026-10-16", status: null, calories: 900, protein_g: 50 }, { id: "2", athlete_id: "b", log_date: "2026-10-16", status: null, calories: 900, protein_g: 50 }],
      client_macro_target_history: [
        { athlete_id: "a", group_id: "g", effective_from: "2026-01-01", calories: 2000, protein_g: 150, carbs_g: 0, fat_g: 0 },
        { athlete_id: "b", group_id: "g", effective_from: "2026-01-01", calories: 2000, protein_g: 150, carbs_g: 0, fat_g: 0 },
      ],
      group_memberships: [{ id: "m1", profile_id: "b", group_id: "g", food_tracking_enabled: true, coach_sets_macros: false }],
    };
    for (const code of ["42P01", "PGRST205"]) {
      const w = await loadNutritionWeek(fakeDb(tables, { client_nutrition_flags: { code } }), [client("a", "Ann"), client("b", "Bo")], "2026-10-17", adults);
      expect(w.flagsUnreadable, code).toBeUndefined();
      expect(w.rows.find((r) => r.id === "a"), code).toMatchObject({ status: "under", neutral: false });
      expect(w.rows.find((r) => r.id === "b"), code).toMatchObject({ status: "logged", neutral: true });
    }
  });

  it("a client with the safety switch on is shown neutrally (the flag read feeds the table)", async () => {
    const db = fakeDb({
      food_log_entries: [{ id: "1", athlete_id: "a", log_date: "2026-10-16", status: null, calories: 900, protein_g: 50 }],
      client_macro_target_history: [{ athlete_id: "a", group_id: "g", effective_from: "2026-01-01", calories: 2000, protein_g: 150, carbs_g: 0, fat_g: 0 }],
      client_nutrition_flags: [{ profile_id: "a", group_id: "other" }],
    });
    const w = await loadNutritionWeek(db, [client("a", "Ann")], "2026-10-17", adults);
    expect(w.rows[0]).toMatchObject({ status: "logged", calorieGapPct: null, suggestionsOff: true });
  });

  it("reads every standing-target row past the 1,000-row page, keeps each group's own target, and uses the newest row", async () => {
    // 1,200 dated rows for client "a" in group g (newest, last, is 2600), and one row in g2 (3000).
    const history = Array.from({ length: 1200 }, (_, i) => ({
      athlete_id: "a",
      group_id: "g",
      effective_from: `2020-01-01T${String(i).padStart(4, "0")}`.slice(0, 10) === "2020-01-01" ? new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10) : "",
      calories: i === 1199 ? 2600 : 1500,
      protein_g: 100,
      carbs_g: 0,
      fat_g: 0,
    })).filter((r) => r.effective_from <= "2026-10-17");
    expect(history.length).toBeGreaterThan(1000);
    const rows = [...history, { athlete_id: "a", group_id: "g2", effective_from: "2026-01-01", calories: 3000, protein_g: 200, carbs_g: 0, fat_g: 0 }];
    const db = fakeDb({ client_macro_target_history: rows, food_log_entries: [{ id: "1", athlete_id: "a", log_date: "2026-10-16", status: null, calories: 2600, protein_g: 120 }] });
    const w = await loadNutritionWeek(db, [client("a", "Ann", "g"), client("a", "Ann", "g2")], "2026-10-17", adults);
    expect(w.failed).toBe(false);
    expect(w.rows.find((r) => r.groupId === "g")).toMatchObject({ targetCalories: 2600 });
    expect(w.rows.find((r) => r.groupId === "g2")).toMatchObject({ targetCalories: 3000 });
  });

  it("a client with no history row falls back to the single-row target", async () => {
    const db = fakeDb({ client_macro_targets: [{ athlete_id: "a", group_id: "g", calories: 2200, protein_g: 140, carbs_g: 0, fat_g: 0, updated_at: "2026-02-01T00:00:00Z" }] });
    const w = await loadNutritionWeek(db, [client("a", "Ann")], "2026-10-17", adults);
    expect(w.rows[0]).toMatchObject({ targetCalories: 2200 });
  });

  it("someone not a confirmed adult, and everyone if age could not be told, is shown neutrally", async () => {
    const db = fakeDb({
      food_log_entries: [{ id: "1", athlete_id: "a", log_date: "2026-10-16", status: null, calories: 900, protein_g: 50 }],
      client_macro_target_history: [{ athlete_id: "a", group_id: "g", effective_from: "2026-01-01", calories: 2000, protein_g: 150, carbs_g: 0, fat_g: 0 }],
    });
    expect((await loadNutritionWeek(db, [client("a")], "2026-10-17", async () => new Set(["a"]))).rows[0]).toMatchObject({ status: "logged", neutral: true });
    expect((await loadNutritionWeek(db, [client("a")], "2026-10-17", async () => new Set(["*"]))).rows[0]).toMatchObject({ status: "logged", neutral: true });
  });

  it("caps the table and says how many there are", async () => {
    const clients = Array.from({ length: MAX_ROWS + 25 }, (_, i) => client(`c${i}`, `Client ${String(i).padStart(3, "0")}`));
    const w = await loadNutritionWeek(fakeDb({}), clients, "2026-10-17", adults);
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
    expect(section).toContain("Logged ${r.daysLogged} of 7 days");
    expect(section).not.toMatch(/\.(insert|update|delete|upsert)\(/);
    expect(src("lib/coach-nutrition-week.ts")).not.toMatch(/\.(insert|update|delete|upsert)\(/);
  });
});
