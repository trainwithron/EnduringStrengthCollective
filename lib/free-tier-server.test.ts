import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({}) }));
const budget = vi.hoisted(() => ({ orgId: "o1" as string | null, balanceUsd: 0 }));
vi.mock("@/lib/ai-budget-server", () => ({
  resolveOrg: async () => budget.orgId,
  getCoachBudgetStatus: async () => ({ balanceUsd: budget.balanceUsd }),
}));

import { freeTierMeter, hasPaidAiBalance, isFreeTierCoach, isZeroAiCoach, takeFreeTierUse } from "./free-tier-server";
import { FREE_TIER_AI_USES } from "./ai-usage";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const DAY = 86_400_000;

// A tiny stand-in database: the organization (when it was made), its billing row, the coach's credit balance and the usage log.
function fakeDb(opts: { createdDaysAgo: number; billing?: Record<string, unknown> | null; credits?: number; usedUses?: number; insertFails?: boolean; racer?: boolean }) {
  const log: { id: string; feature: string }[] = Array.from({ length: opts.usedUses ?? 0 }, (_, i) => ({ id: `u${i}`, feature: "free_use_program" }));
  let reads = 0;
  const db = {
    reads: () => reads,
    log: () => log,
    from(table: string) {
      reads++;
      if (table === "organizations") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { created_at: new Date(Date.now() - opts.createdDaysAgo * DAY).toISOString() } }) }) }) };
      if (table === "organization_billing") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.billing ?? null }) }) }) };
      if (table === "coach_credits") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { balance: opts.credits ?? 0 } }) }) }) };
      // ai_usage_log
      return {
        select: () => ({ eq: () => ({ in: () => ({ gte: async () => ({ count: log.length, error: null }) }) }) }),
        insert: (row: { feature: string }) => ({
          select: () => ({
            maybeSingle: async () => {
              if (opts.insertFails) return { data: null, error: { message: "no" } };
              if (opts.racer) log.push({ id: "other", feature: "free_use_program" }); // another request lands first
              const id = `n${log.length}`;
              log.push({ id, feature: row.feature });
              return { data: { id }, error: null };
            },
          }),
        }),
        delete: () => ({
          eq: async (_c: string, id: string) => {
            const i = log.findIndex((l) => l.id === id);
            if (i >= 0) log.splice(i, 1);
            return { error: null };
          },
        }),
      };
    },
  };
  return db;
}

const saved = process.env.COACH_BILLING_ENFORCED;
beforeEach(() => {
  budget.orgId = "o1";
  budget.balanceUsd = 0;
  process.env.COACH_BILLING_ENFORCED = "true";
});
afterEach(() => {
  if (saved === undefined) delete process.env.COACH_BILLING_ENFORCED;
  else process.env.COACH_BILLING_ENFORCED = saved;
});

describe("who is on the free tier", () => {
  it("nobody, and nothing is even read, while billing is not enforced", async () => {
    delete process.env.COACH_BILLING_ENFORCED;
    const db = fakeDb({ createdDaysAgo: 400 });
    expect(await isFreeTierCoach(db, "c1")).toBe(false);
    expect(await isZeroAiCoach(db, "c1")).toBe(false);
    expect(db.reads()).toBe(0);
  });
  it("a coach whose trial ended with no plan, once billing is enforced", async () => {
    expect(await isFreeTierCoach(fakeDb({ createdDaysAgo: 400 }), "c1")).toBe(true);
  });
  it("not a coach in their trial, with a plan, or on a founding (exempt) account", async () => {
    expect(await isFreeTierCoach(fakeDb({ createdDaysAgo: 3 }), "c1")).toBe(false);
    expect(await isFreeTierCoach(fakeDb({ createdDaysAgo: 400, billing: { subscription_status: "active" } }), "c1")).toBe(false);
    expect(await isFreeTierCoach(fakeDb({ createdDaysAgo: 400, billing: { billing_exempt: true } }), "c1")).toBe(false);
  });
  it("not when the organization cannot be found (a coach is never cut off by a read that did not work)", async () => {
    budget.orgId = null;
    expect(await isFreeTierCoach(fakeDb({ createdDaysAgo: 400 }), "c1")).toBe(false);
  });
  it("a free-tier coach who has bought AI credits or a top-up is not held to it", async () => {
    expect(await hasPaidAiBalance(fakeDb({ createdDaysAgo: 400, credits: 3 }), "c1")).toBe(true);
    budget.balanceUsd = 3.5;
    expect(await isZeroAiCoach(fakeDb({ createdDaysAgo: 400 }), "c1")).toBe(false);
  });
});

describe("the five free uses", () => {
  it("takes one each time until they are gone, then says so", async () => {
    const db = fakeDb({ createdDaysAgo: 400 });
    for (let i = 1; i <= FREE_TIER_AI_USES; i++) {
      const r = await takeFreeTierUse(db, "c1", "program");
      expect(r).toMatchObject({ ok: true, free: true, used: i });
    }
    const out = await takeFreeTierUse(db, "c1", "meal_plan");
    expect(out.ok).toBe(false);
    expect((out as { error: string }).error).toContain("5 free AI uses");
    expect(db.log()).toHaveLength(FREE_TIER_AI_USES);
  });
  it("two at once cannot both take the last one: whoever finds too many gives theirs back", async () => {
    const db = fakeDb({ createdDaysAgo: 400, usedUses: FREE_TIER_AI_USES - 1, racer: true });
    const r = await takeFreeTierUse(db, "c1", "program");
    expect(r.ok).toBe(false);
    expect(db.log()).toHaveLength(FREE_TIER_AI_USES);
  });
  it("takes nothing and allows everything off the free tier", async () => {
    const db = fakeDb({ createdDaysAgo: 3 });
    expect(await takeFreeTierUse(db, "c1", "program")).toEqual({ ok: true, free: false });
    expect(db.log()).toHaveLength(0);
  });
  it("a coach who has paid is not charged a free use", async () => {
    const db = fakeDb({ createdDaysAgo: 400, credits: 5, usedUses: 5 });
    expect(await takeFreeTierUse(db, "c1", "program")).toEqual({ ok: true, free: false });
  });
  it("if the use cannot be written the answer is a plain pause, not a free pass", async () => {
    const r = await takeFreeTierUse(fakeDb({ createdDaysAgo: 400, insertFails: true }), "c1", "import");
    expect(r.ok).toBe(false);
  });
  it("the meter shows what is left, and nothing off the free tier", async () => {
    expect(await freeTierMeter(fakeDb({ createdDaysAgo: 400, usedUses: 2 }), "c1")).toEqual({ freeTier: true, used: 2, limit: 5, left: 3 });
    expect((await freeTierMeter(fakeDb({ createdDaysAgo: 3 }), "c1")).freeTier).toBe(false);
  });
});

describe("wiring of the free tier", () => {
  it("the gate sits in reserveAiCall, refuses everything except the big uses' own calls, and covers the nightly jobs", () => {
    const gate = src("lib/ai-usage-server.ts");
    expect(gate).toContain("isFreeTierCoach(supabase, billingCoach)");
    expect(gate).toContain("!FREE_TIER_INNER_FEATURES.has(meta.feature)");
    expect(gate.indexOf("isFreeTierCoach(supabase, billingCoach)")).toBeLessThan(gate.indexOf("getCoachBudgetStatus(supabase, billingCoach)"));
    for (const f of ["app/api/cron/coach-briefing/route.ts", "app/api/cron/spotter-tier-sync/route.ts", "app/api/session-pattern-check/route.ts"]) expect(src(f), f).toContain("isZeroAiCoach(");
  });
  it("each big action takes a use before any model call", () => {
    const places: [string, string][] = [
      ["app/api/ai/generate-program/route.ts", '"program"'],
      ["app/api/ai/pick-template/route.ts", '"program"'],
      ["app/api/ai/build-day/route.ts", '"program"'],
      ["app/api/ai/parse-workout/route.ts", '"import"'],
      ["app/api/ai/meal-plan-credit-charge/route.ts", '"meal_plan"'],
    ];
    for (const [f, kind] of places) {
      const code = src(f);
      expect(code, f).toContain(`freeTierUseOrRefuse(`);
      expect(code, f).toContain(kind);
    }
    expect(src("app/api/ai/meal-plan-credit-charge/route.ts").indexOf("freeTierUseOrRefuse(")).toBeLessThan(src("app/api/ai/meal-plan-credit-charge/route.ts").indexOf("checkAndSpendCoachCredits(createServiceRoleClient()"));
  });
});
