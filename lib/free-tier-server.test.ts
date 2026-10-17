import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({}) }));
const budget = vi.hoisted(() => ({ balanceUsd: 0 }));
vi.mock("@/lib/ai-budget-server", () => ({
  getCoachBudgetStatus: async () => ({ balanceUsd: budget.balanceUsd }),
}));

import { freeTierMeter, hasPaidAiBalance, isFreeTierCoach, isZeroAiCoach, takeFreeTierUse } from "./free-tier-server";
import { FREE_TIER_AI_USES } from "./ai-usage";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const DAY = 86_400_000;

interface FakeOrg {
  id: string;
  createdDaysAgo: number;
  billing?: Record<string, unknown> | null;
  members?: string[];
}
interface Opts {
  orgs: FakeOrg[];
  credits?: number;
  mode?: "metered" | "unlimited";
  liftOff?: boolean;
  usedUses?: number;
  insertFails?: boolean;
  // another request's row lands just before this one's own insert
  racer?: boolean;
  deleteFails?: boolean;
}

// A tiny stand-in database: the coach's organizations (with their billing rows and members), their credit balance and Lift Off, and the usage log.
function fakeDb(opts: Opts) {
  const log: { id: string; feature: string; created_at: string }[] = Array.from({ length: opts.usedUses ?? 0 }, (_, i) => ({ id: `u${String(i).padStart(3, "0")}`, feature: "free_use_program", created_at: new Date(Date.now() - 1000 * (100 - i)).toISOString() }));
  let reads = 0;
  let seq = 0;
  const db = {
    reads: () => reads,
    log: () => log,
    from(table: string) {
      reads++;
      if (table === "organization_memberships") {
        return {
          select: (cols: string) => ({
            eq: (col: string, value: string) =>
              col === "profile_id"
                ? { order: async () => ({ data: opts.orgs.map((o) => ({ organization_id: o.id })) }) }
                : { limit: async () => ({ data: (opts.orgs.find((o) => o.id === value)?.members ?? []).map((m) => ({ profile_id: m })) }) },
          }),
        };
      }
      if (table === "organizations") {
        return { select: () => ({ eq: (_c: string, id: string) => ({ maybeSingle: async () => ({ data: { created_at: new Date(Date.now() - (opts.orgs.find((o) => o.id === id)?.createdDaysAgo ?? 0) * DAY).toISOString() } }) }) }) };
      }
      if (table === "organization_billing") {
        return { select: () => ({ eq: (_c: string, id: string) => ({ maybeSingle: async () => ({ data: opts.orgs.find((o) => o.id === id)?.billing ?? null }) }) }) };
      }
      if (table === "coach_credits") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { balance: opts.credits ?? 0, ai_access_mode: opts.mode ?? "metered" } }) }) }) };
      if (table === "lift_off_subscriptions") return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.liftOff ? { status: "active" } : null }) }) }) }) };
      // ai_usage_log
      return {
        select: () => ({
          in: () => ({ in: () => ({ gte: () => ({ order: () => ({ order: () => ({ limit: async () => ({ data: [...log].sort((a, b) => (a.created_at === b.created_at ? a.id.localeCompare(b.id) : a.created_at.localeCompare(b.created_at))), error: null }) }) }) }) }) }),
        }),
        insert: (row: { feature: string }) => ({
          select: () => ({
            maybeSingle: async () => {
              if (opts.insertFails) return { data: null, error: { message: "no" } };
              if (opts.racer) log.push({ id: "other", feature: "free_use_program", created_at: new Date(Date.now() - 5).toISOString() }); // another request landed first
              const id = `n${seq++}`;
              log.push({ id, feature: row.feature, created_at: new Date().toISOString() });
              return { data: { id }, error: null };
            },
          }),
        }),
        delete: () => ({
          eq: async (_c: string, id: string) => {
            if (opts.deleteFails) return { error: { message: "no" } };
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

const expired: FakeOrg = { id: "o1", createdDaysAgo: 400, members: ["c1"] };
const saved = process.env.COACH_BILLING_ENFORCED;
beforeEach(() => {
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
    const db = fakeDb({ orgs: [expired] });
    expect(await isFreeTierCoach(db, "c1")).toBe(false);
    expect(await isZeroAiCoach(db, "c1")).toBe(false);
    expect(db.reads()).toBe(0);
  });
  it("a coach whose trial ended with no plan, once billing is enforced", async () => {
    expect(await isFreeTierCoach(fakeDb({ orgs: [expired] }), "c1")).toBe(true);
  });
  it("not a coach in their trial, with a plan, or on a founding (exempt) account", async () => {
    expect(await isFreeTierCoach(fakeDb({ orgs: [{ ...expired, createdDaysAgo: 3 }] }), "c1")).toBe(false);
    expect(await isFreeTierCoach(fakeDb({ orgs: [{ ...expired, billing: { subscription_status: "active" } }] }), "c1")).toBe(false);
    expect(await isFreeTierCoach(fakeDb({ orgs: [{ ...expired, billing: { billing_exempt: true } }] }), "c1")).toBe(false);
  });
  it("a lapsed plan is the free tier too", async () => {
    expect(await isFreeTierCoach(fakeDb({ orgs: [{ ...expired, billing: { subscription_status: "canceled", current_period_end: new Date(Date.now() - 10 * DAY).toISOString() } }] }), "c1")).toBe(true);
  });
  it("not when the coach has no organization (a coach is never cut off by a read that did not work)", async () => {
    expect(await isFreeTierCoach(fakeDb({ orgs: [] }), "c1")).toBe(false);
  });
  it("a coach in two organizations is judged by the one being served, and with no context only if EVERY one is free", async () => {
    const paid: FakeOrg = { id: "o2", createdDaysAgo: 400, billing: { subscription_status: "active" } };
    const db = fakeDb({ orgs: [expired, paid] });
    expect(await isFreeTierCoach(db, "c1", { organizationId: "o1" })).toBe(true);
    expect(await isFreeTierCoach(db, "c1", { organizationId: "o2" })).toBe(false);
    expect(await isFreeTierCoach(db, "c1")).toBe(false); // one paying organization: never cut off because of the other
    expect(await isFreeTierCoach(fakeDb({ orgs: [expired, { ...expired, id: "o3" }] }), "c1")).toBe(true);
    // and the reverse order makes no difference
    expect(await isFreeTierCoach(fakeDb({ orgs: [paid, expired] }), "c1", { organizationId: "o1" })).toBe(true);
  });
});

describe("who pays for AI", () => {
  it("credits, a top-up balance, an active Lift Off, or an internal unlimited account", async () => {
    expect(await hasPaidAiBalance(fakeDb({ orgs: [expired], credits: 3 }), "c1")).toBe(true);
    expect(await hasPaidAiBalance(fakeDb({ orgs: [expired], liftOff: true }), "c1")).toBe(true); // even with the credits all spent
    expect(await hasPaidAiBalance(fakeDb({ orgs: [expired], mode: "unlimited" }), "c1")).toBe(true);
    budget.balanceUsd = 3.5;
    expect(await hasPaidAiBalance(fakeDb({ orgs: [expired] }), "c1")).toBe(true);
    budget.balanceUsd = 0;
    expect(await hasPaidAiBalance(fakeDb({ orgs: [expired] }), "c1")).toBe(false);
  });
  it("a paying free-tier coach is not a zero-AI coach", async () => {
    expect(await isZeroAiCoach(fakeDb({ orgs: [expired], mode: "unlimited" }), "c1")).toBe(false);
    expect(await isZeroAiCoach(fakeDb({ orgs: [expired], liftOff: true }), "c1")).toBe(false);
    expect(await isZeroAiCoach(fakeDb({ orgs: [expired] }), "c1")).toBe(true);
  });
});

describe("the five free uses", () => {
  it("takes one each time until they are gone, then says so", async () => {
    const db = fakeDb({ orgs: [expired] });
    for (let i = 1; i <= FREE_TIER_AI_USES; i++) {
      const r = await takeFreeTierUse(db, "c1", "program");
      expect(r).toMatchObject({ ok: true, free: true, used: i });
    }
    const out = await takeFreeTierUse(db, "c1", "meal_plan");
    expect(out.ok).toBe(false);
    expect((out as { error: string }).error).toContain("5 free AI uses");
    expect(db.log()).toHaveLength(FREE_TIER_AI_USES);
  });
  it("two at once for the last use: exactly one wins, in the order they were written", async () => {
    const db = fakeDb({ orgs: [expired], usedUses: FREE_TIER_AI_USES - 1, racer: true });
    const r = await takeFreeTierUse(db, "c1", "program");
    // the other request's row was written first, so it holds the last place and this one is the one refused
    expect(r.ok).toBe(false);
    expect(db.log()).toHaveLength(FREE_TIER_AI_USES);
    expect(db.log().some((l) => l.id === "other")).toBe(true);
  });
  it("a refused use whose row cannot be given back does not pass, and the failure is not hidden", async () => {
    const db = fakeDb({ orgs: [expired], usedUses: FREE_TIER_AI_USES - 1, racer: true, deleteFails: true });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await takeFreeTierUse(db, "c1", "program");
    expect(r.ok).toBe(false);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
  it("the uses are one allowance for the whole organization, not one per trainer", async () => {
    const org: FakeOrg = { ...expired, members: ["c1", "c2"] };
    const db = fakeDb({ orgs: [org], usedUses: FREE_TIER_AI_USES });
    expect((await takeFreeTierUse(db, "c2", "program")).ok).toBe(false);
  });
  it("takes nothing and allows everything off the free tier", async () => {
    const db = fakeDb({ orgs: [{ ...expired, createdDaysAgo: 3 }] });
    expect(await takeFreeTierUse(db, "c1", "program")).toEqual({ ok: true, free: false });
    expect(db.log()).toHaveLength(0);
  });
  it("a coach who has paid is not charged a free use", async () => {
    const db = fakeDb({ orgs: [expired], credits: 5, usedUses: 5 });
    expect(await takeFreeTierUse(db, "c1", "program")).toEqual({ ok: true, free: false });
  });
  it("if the use cannot be written the answer is a plain pause, not a free pass", async () => {
    const r = await takeFreeTierUse(fakeDb({ orgs: [expired], insertFails: true }), "c1", "import");
    expect(r.ok).toBe(false);
  });
  it("the meter shows what is left, and nothing off the free tier", async () => {
    expect(await freeTierMeter(fakeDb({ orgs: [expired], usedUses: 2 }), "c1")).toEqual({ freeTier: true, used: 2, limit: 5, left: 3 });
    expect((await freeTierMeter(fakeDb({ orgs: [{ ...expired, createdDaysAgo: 3 }] }), "c1")).freeTier).toBe(false);
  });
});

describe("wiring of the free tier", () => {
  it("the gate sits in reserveAiCall, refuses everything except the big uses' own calls, and covers the nightly jobs with the organization they serve", () => {
    const gate = src("lib/ai-usage-server.ts");
    expect(gate).toContain("isFreeTierCoach(supabase, billingCoach)");
    expect(gate).toContain("!FREE_TIER_INNER_FEATURES.has(meta.feature)");
    expect(gate.indexOf("isFreeTierCoach(supabase, billingCoach)")).toBeLessThan(gate.indexOf("getCoachBudgetStatus(supabase, billingCoach)"));
    expect(src("app/api/cron/coach-briefing/route.ts")).toContain("isZeroAiCoach(supabase, coachId, { organizationId })");
    expect(src("app/api/cron/spotter-tier-sync/route.ts")).toContain("isZeroAiCoach(supabase, coachId, { organizationId:");
    expect(src("app/api/session-pattern-check/route.ts")).toContain("isZeroAiCoach(admin, coachId, { organizationId: groupOrgId })");
  });
  it("the meal plan limits say what happened, and failed slots are not counted", () => {
    const gate = src("lib/ai-usage-server.ts");
    expect(gate).toContain("freeTierPlanWindowMessage()");
    expect(gate).toContain("freeTierSlotLimitMessage()");
    expect(gate).toContain('.neq("status", "error")');
  });
  it("the plan page words the free plan only when billing is enforced, from the constants", () => {
    const panel = src("components/coach/desktop/plan-billing-panel.tsx");
    expect(panel).toContain("FREE_TIER_CLIENT_LIMIT");
    expect(panel).toContain("FREE_TIER_AI_USES");
    expect(panel).toContain("e.enforced ? FREE_PLAN_SENTENCE");
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
