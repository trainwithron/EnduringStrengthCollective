import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadNutritionWeek, MAX_ROWS, orderForList, summarizeWeek, weekFacts, type FoodRow, type WeekClient, type WeekRow } from "./coach-nutrition-week";

// Nov 19 revamp: "This week" folds into the Clients list as three plain facts per client (days logged, days the protein target was reached, last log). No status engine.
const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const client = (id: string, name = id, groupId = "g"): WeekClient => ({ id, groupId, fullName: name });
const food = (athlete: string, day: string, protein = 0, status: string | null = null): FoodRow => ({ athlete_id: athlete, log_date: day, status, protein_g: protein });
const adults = async () => new Set<string>();
const TODAY = "2026-10-17"; // the week is Oct 11 .. Oct 17
const standing = (protein: number | null) => new Map([["a|g", [{ effective_from: "2026-01-01", calories: 2000, protein_g: protein, carbs_g: null, fat_g: null }]]]);
const label = (k: string) => k.slice(5);

describe("a client's three facts", () => {
  it("days logged (a skipped meal is not food), days the protein target was reached, and the last log", () => {
    const [row] = summarizeWeek({
      clients: [client("a", "Ann")],
      food: [
        food("a", "2026-10-12", 80),
        food("a", "2026-10-12", 80), // same day: 160, reaches 150
        food("a", "2026-10-13", 120), // under 150
        food("a", "2026-10-15", 500, "skipped"), // not logged
        food("a", "2026-10-16", 150), // exactly the target counts
      ],
      todayKey: TODAY,
      histories: standing(150),
    });
    expect(row).toMatchObject({ daysLogged: 3, proteinHitDays: 2, lastLogDate: "2026-10-16", trackingOff: false });
    expect(weekFacts(row, label)).toEqual(["3 of 7 days logged", "Protein target 2 of 7", "Last log 10-16"]);
  });

  it("a day's own protein target, or its meal plan's, wins over the standing target that day", () => {
    const [row] = summarizeWeek({
      clients: [client("a")],
      food: [food("a", "2026-10-12", 120), food("a", "2026-10-13", 120)],
      todayKey: TODAY,
      histories: standing(150),
      dayProteinTargets: new Map([["a|g|2026-10-12", 100]]),
    });
    expect(row.proteinHitDays).toBe(1);
  });

  it("no protein target this week: no protein fact at all (never 0 of 7)", () => {
    const [row] = summarizeWeek({ clients: [client("a")], food: [food("a", "2026-10-12", 120)], todayKey: TODAY, histories: standing(null) });
    expect(row.proteinHitDays).toBeNull();
    expect(weekFacts(row, label)).toEqual(["1 of 7 days logged", "Last log 10-12"]);
  });

  it("a client who is not compared with a target (the safety switch, not a confirmed adult, or when that could not be told) gets only days logged and the last log", () => {
    for (const neutral of [new Set(["a"]), new Set(["a|g"]), new Set(["*"])]) {
      const [row] = summarizeWeek({ clients: [client("a")], food: [food("a", "2026-10-12", 200)], todayKey: TODAY, histories: standing(150), neutral });
      expect(row.proteinHitDays).toBeNull();
    }
  });

  it("nothing this week: the last log from before it, or none; food tracking off says so", () => {
    const rows = summarizeWeek({
      clients: [client("a", "Ann"), client("b", "Bo"), client("c", "Cy")],
      food: [],
      todayKey: TODAY,
      lastLogBefore: new Map([["a", "2026-09-30"]]),
      trackingOff: new Set(["c|g"]),
    });
    expect(weekFacts(rows[0], label)).toEqual(["0 of 7 days logged", "Last log 09-30"]);
    expect(weekFacts(rows[1], label)).toEqual(["0 of 7 days logged", "No logs yet"]);
    expect(weekFacts(rows[2], label)).toEqual(["Food tracking off", "No logs yet"]);
  });

  it("a person in two groups is counted against each group's own target", () => {
    const rows = summarizeWeek({
      clients: [client("a", "Ann", "g1"), client("a", "Ann", "g2")],
      food: [food("a", "2026-10-12", 160)],
      todayKey: TODAY,
      histories: new Map([
        ["a|g1", [{ effective_from: "2026-01-01", calories: 2000, protein_g: 150, carbs_g: null, fat_g: null }]],
        ["a|g2", [{ effective_from: "2026-01-01", calories: 3000, protein_g: 200, carbs_g: null, fat_g: null }]],
      ]),
    });
    expect(rows.map((r) => r.proteinHitDays)).toEqual([1, 0]);
  });

  it("the list: clients with no logs this week first, then everyone by name", () => {
    const row = (name: string, days: number) => ({ id: name, groupId: "g", fullName: name, daysLogged: days, proteinHitDays: null, lastLogDate: null, trackingOff: false }) as WeekRow;
    expect(orderForList([row("Ann", 5), row("Zed", 0), row("Bo", 1), row("Cy", 0)]).map((r) => r.fullName)).toEqual(["Cy", "Zed", "Ann", "Bo"]);
  });
});

// A stand-in database that pages like the real one: each table answers with its rows, cut to the requested range, whatever the filters.
function fakeDb(tables: Record<string, unknown[]>, failing: string[] | Record<string, { code?: string }> = []) {
  const errors: Record<string, { code?: string }> = Array.isArray(failing) ? Object.fromEntries(failing.map((t) => [t, {}])) : failing;
  return {
    from(table: string) {
      let range: [number, number] | null = null;
      let single = false;
      const answer = () => {
        if (errors[table]) return { data: null, error: { message: "x", ...errors[table] } };
        const rows = tables[table] ?? [];
        if (single) return { data: rows[0] ?? null, error: null };
        return { data: range ? rows.slice(range[0], range[1] + 1) : rows, error: null };
      };
      const q: any = {
        select: () => q,
        in: () => q,
        eq: () => q,
        neq: () => q,
        gte: () => q,
        lte: () => q,
        lt: () => q,
        or: () => q,
        order: () => q,
        limit: () => q,
        range: (a: number, b: number) => ((range = [a, b]), q),
        maybeSingle: async () => ((single = true), answer()),
        then: (resolve: (v: unknown) => void) => resolve(answer()),
      };
      return q;
    },
  } as any;
}

describe("loading the list", () => {
  it("a failed read the facts depend on is reported as failed, never shown as clients with no logs", async () => {
    for (const table of ["food_log_entries", "group_memberships", "client_macro_target_history", "client_macro_targets", "daily_macros", "meal_plans"]) {
      const w = await loadNutritionWeek(fakeDb({}, [table]), [client("a")], TODAY, adults);
      expect(w.failed, table).toBe(true);
      expect(w.rows).toEqual([]);
    }
  });

  it("puts the reads together: this week's logs, the standing target, and a day's own target", async () => {
    const db = fakeDb({
      food_log_entries: [
        { id: "1", athlete_id: "a", log_date: "2026-10-16", status: null, protein_g: 120 },
        { id: "2", athlete_id: "a", log_date: "2026-10-15", status: null, protein_g: 160 },
      ],
      client_macro_target_history: [{ athlete_id: "a", group_id: "g", effective_from: "2026-01-01", calories: 2000, protein_g: 150, carbs_g: 200, fat_g: 60 }],
      daily_macros: [{ id: "d", athlete_id: "a", group_id: "g", log_date: "2026-10-16", calories: 1800, protein_g: 100, carbs_g: null, fat_g: null }],
      group_memberships: [{ id: "m", profile_id: "a", group_id: "g", food_tracking_enabled: true, coach_sets_macros: null }],
    });
    const w = await loadNutritionWeek(db, [client("a", "Ann")], TODAY, adults);
    expect(w.failed).toBe(false);
    expect(w.rows[0]).toMatchObject({ fullName: "Ann", daysLogged: 2, proteinHitDays: 2, lastLogDate: "2026-10-16" });
  });

  it("a client idle this week gets their last log from before it; if that read fails, the list says so", async () => {
    const tables = { food_log_entries: [{ id: "1", athlete_id: "a", log_date: "2026-09-30", status: null, protein_g: 10 }] };
    // (the stand-in answers the week's read with the same row; it is outside the week, so it is not counted as logged)
    const w = await loadNutritionWeek(fakeDb(tables), [client("a", "Ann")], TODAY, adults);
    expect(w.rows[0]).toMatchObject({ daysLogged: 0, lastLogDate: "2026-09-30" });
  });

  it("if the safety switch cannot be read (or is cut short), nobody is compared with a target", async () => {
    const tables = {
      food_log_entries: [{ id: "1", athlete_id: "a", log_date: "2026-10-16", status: null, protein_g: 200 }],
      client_macro_target_history: [{ athlete_id: "a", group_id: "g", effective_from: "2026-01-01", calories: 2000, protein_g: 150, carbs_g: 0, fat_g: 0 }],
    };
    expect((await loadNutritionWeek(fakeDb(tables, { client_nutrition_flags: {} }), [client("a")], TODAY, adults)).rows[0].proteinHitDays).toBeNull();
    const flags = Array.from({ length: 26_000 }, (_, i) => ({ profile_id: `p${i}`, group_id: "x" }));
    expect((await loadNutritionWeek(fakeDb({ ...tables, client_nutrition_flags: flags }), [client("a")], TODAY, adults)).rows[0].proteinHitDays).toBeNull();
  });

  it("only a MISSING flags table reads as nobody flagged; No macros for a client, the switch, and a minor each stop the comparison", async () => {
    const tables = {
      food_log_entries: [{ id: "1", athlete_id: "a", log_date: "2026-10-16", status: null, protein_g: 200 }, { id: "2", athlete_id: "b", log_date: "2026-10-16", status: null, protein_g: 200 }],
      client_macro_target_history: [
        { athlete_id: "a", group_id: "g", effective_from: "2026-01-01", calories: 2000, protein_g: 150, carbs_g: 0, fat_g: 0 },
        { athlete_id: "b", group_id: "g", effective_from: "2026-01-01", calories: 2000, protein_g: 150, carbs_g: 0, fat_g: 0 },
      ],
      group_memberships: [{ id: "m1", profile_id: "b", group_id: "g", food_tracking_enabled: true, coach_sets_macros: false }],
    };
    for (const code of ["42P01", "PGRST205"]) {
      const w = await loadNutritionWeek(fakeDb(tables, { client_nutrition_flags: { code } }), [client("a", "Ann"), client("b", "Bo")], TODAY, adults);
      expect(w.rows.find((r) => r.id === "a")?.proteinHitDays, code).toBe(1);
      expect(w.rows.find((r) => r.id === "b")?.proteinHitDays, code).toBeNull();
    }
    const flagged = await loadNutritionWeek(fakeDb({ ...tables, client_nutrition_flags: [{ profile_id: "a", group_id: "other" }] }), [client("a")], TODAY, adults);
    expect(flagged.rows[0].proteinHitDays).toBeNull();
    const minor = await loadNutritionWeek(fakeDb(tables), [client("a")], TODAY, async () => new Set(["a"]));
    expect(minor.rows[0].proteinHitDays).toBeNull();
  });

  it("food tracking switched off for the client says so", async () => {
    const db = fakeDb({ group_memberships: [{ id: "m", profile_id: "a", group_id: "g", food_tracking_enabled: false, coach_sets_macros: null }] });
    expect((await loadNutritionWeek(db, [client("a")], TODAY, adults)).rows[0].trackingOff).toBe(true);
  });

  it("caps the list and says how many there are", async () => {
    const clients = Array.from({ length: MAX_ROWS + 25 }, (_, i) => client(`c${i}`, `Client ${String(i).padStart(3, "0")}`));
    const w = await loadNutritionWeek(fakeDb({}), clients, TODAY, adults);
    expect(w.rows).toHaveLength(MAX_ROWS);
    expect(w.total).toBe(MAX_ROWS + 25);
  });
});

describe("how it is wired", () => {
  it("is the Clients list of the coach Nutrition page, read only, and a client it could not count is still listed by name", () => {
    const page = src("app/(coach)/groups/[groupId]/nutrition/page.tsx");
    expect(page).toContain("await loadNutritionWeek(supabase, athletes.map(");
    expect(page).toContain("<NutritionClientList");
    expect(page).not.toContain("WeeklyNutritionSection");
    const list = src("components/coach/nutrition/nutrition-client-list.tsx");
    expect(list).toContain("weekFacts(r, shortDateLabel)");
    expect(list).toContain("rest.map((a) =>");
    expect(list).toContain("Couldn&apos;t load this week&apos;s numbers");
    expect(src("lib/coach-nutrition-week.ts")).not.toMatch(/\.(insert|update|delete|upsert)\(/);
  });
});
