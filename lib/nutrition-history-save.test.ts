import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { insertRowOf, removeImportedHistory, saveImportedHistory, NOT_SWITCHED_ON, INSERT_BATCH_ROWS } from "./nutrition-history-save";
import type { ImportedFoodRow } from "./nutrition-history-import";

const IDS = { athleteId: "a1", groupId: "g1" };
const row = (date: string, description = "Rice"): ImportedFoodRow => ({ date, mealSlot: "lunch", description, servingLabel: "1 cup", calories: 200, proteinG: 4, carbsG: 44, fatG: 0.4 });

// A stand-in database: the imported days already stored, and every insert it was asked for (each insert can be told to fail).
function fakeDb(opts: { existingDates?: string[]; failInsertNumber?: number; failCode?: string; readFails?: boolean } = {}) {
  const inserts: Record<string, unknown>[][] = [];
  const filters: [string, unknown][] = [];
  const db = {
    from(table: string) {
      expect(table).toBe("food_log_entries");
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => (filters.push([c, v]), q),
        gte: () => q,
        lte: () => q,
        order: () => q,
        range: async () => (opts.readFails ? { data: null, error: { code: "XX" } } : { data: (opts.existingDates ?? []).map((d, i) => ({ id: String(i), log_date: d })), error: null }),
        insert: async (rows: Record<string, unknown>[]) => {
          inserts.push(rows);
          if (opts.failInsertNumber === inserts.length) return { error: { code: opts.failCode ?? "XX000", message: "Failing row contains (secret food)" } };
          return { error: null };
        },
      };
      return q;
    },
  };
  return { db: db as unknown as SupabaseClient, inserts, filters };
}

describe("saving an upload", () => {
  it("writes each row as history only: status quick_log, food_source import, this client and group", () => {
    expect(insertRowOf(row("2026-08-03"), IDS)).toEqual({
      athlete_id: "a1",
      group_id: "g1",
      log_date: "2026-08-03",
      meal_slot: "lunch",
      status: "quick_log",
      description: "Rice",
      serving_label: "1 cup",
      calories: 200,
      protein_g: 4,
      carbs_g: 44,
      fat_g: 0.4,
      food_source: "import",
    });
  });

  it("saves every new day and reports it", async () => {
    const { db, inserts, filters } = fakeDb();
    const r = await saveImportedHistory(db, { ...IDS, rows: [row("2026-08-03"), row("2026-08-03", "Beans"), row("2026-08-04")], todayKey: "2026-11-09" });
    expect(r).toEqual({ ok: true, savedDays: 2, savedRows: 3, alreadyImportedDays: 0, leftOutDays: 0 });
    expect(inserts.flat()).toHaveLength(3);
    // the already-imported check is this client, this group, imported rows only
    expect(filters).toEqual([["athlete_id", "a1"], ["group_id", "g1"], ["food_source", "import"]]);
  });

  it("uploading the same file again adds nothing: a day already imported is left exactly as it is", async () => {
    const { db, inserts } = fakeDb({ existingDates: ["2026-08-03", "2026-08-03", "2026-08-04"] });
    const r = await saveImportedHistory(db, { ...IDS, rows: [row("2026-08-03"), row("2026-08-03", "Beans"), row("2026-08-04")], todayKey: "2026-11-09" });
    expect(r).toEqual({ ok: true, savedDays: 0, savedRows: 0, alreadyImportedDays: 2, leftOutDays: 0 });
    expect(inserts).toEqual([]);
  });

  it("an overlapping file adds only the days that are not there yet (never part of a day)", async () => {
    const { db, inserts } = fakeDb({ existingDates: ["2026-08-04"] });
    const r = await saveImportedHistory(db, { ...IDS, rows: [row("2026-08-03"), row("2026-08-04"), row("2026-08-04", "Beans"), row("2026-08-05")], todayKey: "2026-11-09" });
    expect(r).toMatchObject({ ok: true, savedDays: 2, savedRows: 2, alreadyImportedDays: 1 });
    expect(inserts.flat().map((x) => x.log_date)).toEqual(["2026-08-03", "2026-08-05"]);
  });

  it("leaves out today and later, in the coach's day", async () => {
    const { db, inserts } = fakeDb();
    const r = await saveImportedHistory(db, { ...IDS, rows: [row("2026-11-08"), row("2026-11-09"), row("2026-11-10")], todayKey: "2026-11-09" });
    expect(r).toMatchObject({ ok: true, savedDays: 1, leftOutDays: 2 });
    expect(inserts.flat().map((x) => x.log_date)).toEqual(["2026-11-08"]);
  });

  it("inserts in batches of whole days", async () => {
    const rows: ImportedFoodRow[] = [];
    for (let d = 1; d <= 30; d++) for (let i = 0; i < 40; i++) rows.push(row(`2026-08-${String(d).padStart(2, "0")}`, `f${i}`));
    const { db, inserts } = fakeDb();
    const r = await saveImportedHistory(db, { ...IDS, rows, todayKey: "2026-11-09" });
    expect(r).toMatchObject({ ok: true, savedDays: 30, savedRows: 1200 });
    for (const batch of inserts) {
      expect(batch.length).toBeLessThanOrEqual(INSERT_BATCH_ROWS);
      expect(batch.length % 40).toBe(0);
    }
  });

  it("stops at a failed batch and says how much saved, never logging the food", async () => {
    const rows: ImportedFoodRow[] = [];
    for (let d = 1; d <= 30; d++) for (let i = 0; i < 40; i++) rows.push(row(`2026-08-${String(d).padStart(2, "0")}`, `secret food ${i}`));
    const { db } = fakeDb({ failInsertNumber: 2 });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await saveImportedHistory(db, { ...IDS, rows, todayKey: "2026-11-09" });
    expect(r).toMatchObject({ ok: false, status: 500, savedDays: 12, savedRows: 480 });
    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).not.toContain("secret");
    expect(logged).toContain("XX000");
    spy.mockRestore();
  });

  it("says plainly when the database step is not applied yet (the check refuses the import mark)", async () => {
    const { db } = fakeDb({ failInsertNumber: 1, failCode: "23514" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await saveImportedHistory(db, { ...IDS, rows: [row("2026-08-03")], todayKey: "2026-11-09" });
    spy.mockRestore();
    expect(r).toEqual({ ok: false, status: 503, error: NOT_SWITCHED_ON, savedDays: 0, savedRows: 0 });
  });

  it("saves nothing when it cannot check what is already there", async () => {
    const { db, inserts } = fakeDb({ readFails: true });
    const r = await saveImportedHistory(db, { ...IDS, rows: [row("2026-08-03")], todayKey: "2026-11-09" });
    expect(r.ok).toBe(false);
    expect(inserts).toEqual([]);
  });
});

describe("removing imported history", () => {
  it("deletes only this client's imported rows in this group", async () => {
    const filters: [string, unknown][] = [];
    const q = {
      eq: (c: string, v: unknown) => {
        filters.push([c, v]);
        return filters.length === 3 ? Promise.resolve({ error: null, count: 7 }) : q;
      },
    };
    const db = { from: () => ({ delete: () => q }) } as unknown as SupabaseClient;
    expect(await removeImportedHistory(db, IDS)).toEqual({ ok: true, removed: 7 });
    expect(filters).toEqual([["athlete_id", "a1"], ["group_id", "g1"], ["food_source", "import"]]);
  });
});
