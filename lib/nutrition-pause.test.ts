import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadPausedKeys } from "./nutrition-pause";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

type Row = Record<string, unknown>;
// A stand-in database for the two reads the loader makes (and the one-row probe of the flags table).
function fake(opts: { members?: Row[]; flags?: Row[]; membersError?: boolean; flagsError?: { code: string } }) {
  return {
    from(table: string) {
      const q: any = {
        select: () => q,
        eq: () => q,
        order: () => q,
        limit: () => q,
        range: (from: number, to: number) => {
          q._range = [from, to];
          return q;
        },
        then(resolve: (v: unknown) => void) {
          if (table === "group_memberships") return resolve(opts.membersError ? { data: null, error: { message: "x" } } : { data: slice(opts.members ?? [], q._range), error: null });
          if (opts.flagsError) return resolve({ data: null, error: opts.flagsError });
          return resolve({ data: slice(opts.flags ?? [], q._range), error: null });
        },
      };
      return q;
    },
  } as any;
}
const slice = (rows: Row[], range?: [number, number]) => (range ? rows.slice(range[0], range[1] + 1) : rows);

describe("the clients the weekly nutrition job leaves alone", () => {
  it("includes a client whose coach switched macros off AND one with the automatic-suggestions switch on, per group", async () => {
    const db = fake({
      members: [
        { profile_id: "a", group_id: "g1", coach_sets_macros: false },
        { profile_id: "b", group_id: "g1", coach_sets_macros: null },
        { profile_id: "c", group_id: "g1", coach_sets_macros: true },
      ],
      flags: [{ profile_id: "b", group_id: "g1" }],
    });
    const r = await loadPausedKeys(db);
    expect(r.failed).toBe(false);
    expect([...r.keys].sort()).toEqual(["a|g1", "b|g1"]);
  });

  it("a client switched off in one group is not switched off in another group", async () => {
    const db = fake({ members: [{ profile_id: "b", group_id: "g2", coach_sets_macros: null }], flags: [{ profile_id: "b", group_id: "g1" }] });
    expect([...(await loadPausedKeys(db)).keys]).toEqual(["b|g1"]);
  });

  it("reads past one page of rows", async () => {
    const members = Array.from({ length: 2500 }, (_, i) => ({ profile_id: `p${i}`, group_id: "g", coach_sets_macros: i === 2400 ? false : null }));
    const r = await loadPausedKeys(fake({ members }));
    expect(r.failed).toBe(false);
    expect([...r.keys]).toEqual(["p2400|g"]);
  });

  it("a list that cannot be read is reported as failed, so the job suggests for nobody", async () => {
    expect((await loadPausedKeys(fake({ membersError: true }))).failed).toBe(true);
    expect((await loadPausedKeys(fake({ members: [], flagsError: { code: "XX000" } }))).failed).toBe(true);
  });

  it("a database without the flags table yet (paste pending) just uses the first switch", async () => {
    const r = await loadPausedKeys(fake({ members: [{ profile_id: "a", group_id: "g", coach_sets_macros: false }], flagsError: { code: "42P01" } }));
    expect(r).toEqual({ keys: new Set(["a|g"]), failed: false });
    const viaRest = await loadPausedKeys(fake({ members: [], flagsError: { code: "PGRST205" } }));
    expect(viaRest.failed).toBe(false);
  });
});

describe("how it is wired", () => {
  const cron = src("app/api/cron/nutrition-checkin-suggestions/route.ts");
  it("the weekly job skips a switched-off client in the weekly pass AND in the starting-target pass, and stops entirely if it cannot tell who", () => {
    expect(cron).toContain("loadPausedKeys(supabase)");
    expect(cron).toContain("if (paused.failed) return NextResponse.json");
    expect(cron).toContain("if (paused.keys.has(`${athleteId}|${last.group_id}`)) {");
    expect(cron).toContain("!paused.has(key)");
  });
  it("the switch is a coach-only table, not a column on the membership the client reads", () => {
    const sql = src("supabase/migrations/0408_client_nutrition_flags.sql");
    expect(sql).toContain("create table if not exists public.client_nutrition_flags");
    expect(sql).toContain("using (public.is_group_coach(group_id))");
    expect(sql).not.toMatch(/alter table public\.group_memberships/);
    expect(src("components/coach/nutrition/auto-suggest-off-toggle.tsx")).toContain('.from("client_nutrition_flags")');
    expect(src("components/coach/nutrition/client-nutrition.tsx")).toContain("<AutoSuggestOffSwitch");
  });
});
