import { describe, expect, it } from "vitest";
import { fetchNutrientLog } from "@/lib/nutrient-data";

// A stand-in for the database that, like the real one, hands back at most 1,000 rows however many are asked for.
function fakeLog(total: number, opts: { noNutrientsColumn?: boolean; failAtPage?: number } = {}) {
  const rows = Array.from({ length: total }, (_, i) => ({
    id: String(i).padStart(6, "0"),
    log_date: `2026-10-${String(1 + (i % 8)).padStart(2, "0")}`,
    status: "quick_log",
    description: `Food ${i}`,
    calories: 100,
    nutrients: { iron_mg: 1 },
  }));
  const calls: { columns: string; from: number; to: number }[] = [];
  const supabase = {
    from: () => {
      let columns = "";
      const chain: Record<string, unknown> = {};
      chain.select = (c: string) => {
        columns = c;
        return chain;
      };
      for (const m of ["eq", "gte", "lte", "order"]) chain[m] = () => chain;
      chain.range = (from: number, to: number) => {
        calls.push({ columns, from, to });
        if (opts.noNutrientsColumn && columns.includes("nutrients")) return Promise.resolve({ data: null, error: { message: "column food_log_entries.nutrients does not exist" } });
        if (opts.failAtPage != null && from === opts.failAtPage * 1000) return Promise.resolve({ data: null, error: { message: "boom" } });
        const slice = rows.slice(from, Math.min(to, from + 999) + 1).map((r) => (columns.includes("nutrients") ? r : { ...r, nutrients: undefined }));
        return Promise.resolve({ data: slice, error: null });
      };
      return chain;
    },
  };
  return { supabase: supabase as never, calls };
}

describe("fetchNutrientLog reads the whole log, not just the first 1,000 rows", () => {
  it("reads 1,500 entries across pages", async () => {
    const { supabase, calls } = fakeLog(1500);
    const log = await fetchNutrientLog(supabase, "a1", "2026-10-08");
    expect(log.entries).toHaveLength(1500);
    expect(log.truncated).toBe(false);
    expect(calls.map((c) => [c.from, c.to])).toEqual([[0, 999], [1000, 1999]]);
    expect(log.entries[0]).toMatchObject({ description: "Food 0", nutrients: { iron_mg: 1 } });
  });
  it("reads exactly 1,000 (a full page) and then checks for more", async () => {
    const { supabase, calls } = fakeLog(1000);
    const log = await fetchNutrientLog(supabase, "a1", "2026-10-08");
    expect(log.entries).toHaveLength(1000);
    expect(calls).toHaveLength(2);
  });
  it("a small log is one request", async () => {
    const { supabase, calls } = fakeLog(12);
    expect((await fetchNutrientLog(supabase, "a1", "2026-10-08")).entries).toHaveLength(12);
    expect(calls).toHaveLength(1);
  });
  it("falls back to the calories alone before the database has the detail column, and reports every nutrient as not reported", async () => {
    const { supabase } = fakeLog(1200, { noNutrientsColumn: true });
    const log = await fetchNutrientLog(supabase, "a1", "2026-10-08");
    expect(log.entries).toHaveLength(1200);
    expect(log.entries.every((e) => e.nutrients === null)).toBe(true);
  });
  it("says so when a page cannot be read, instead of quietly using what it has", async () => {
    const { supabase } = fakeLog(2500, { failAtPage: 1, noNutrientsColumn: false });
    const log = await fetchNutrientLog(supabase, "a1", "2026-10-08");
    expect(log.truncated).toBe(true);
  });
});
