import { beforeEach, describe, expect, it, vi } from "vitest";

const sent: { profileId: string; title: string; body: string }[] = [];
vi.mock("@/lib/send-push", () => ({
  sendPushToProfile: async (_db: unknown, profileId: string, title: string, body: string) => {
    sent.push({ profileId, title, body });
    return 1;
  },
}));
let stripeOn = false;
vi.mock("@/lib/stripe", () => ({ isStripeConfigured: () => stripeOn }));

import { aiTopUpPurchasable, getCoachBudgetStatus, getOrgBudgetStatus, logBudgetProblem, monthStartDate, monthStartIso, noteBudgetLevel, resetBudgetLogForTests, resetsOnText, resolveBillingCoach, resolveOrg, topUpInfo } from "@/lib/ai-budget-server";

interface Fake {
  summary?: { clients: number; coaches: number; billing_exempt?: boolean; ai_scale?: number | null; owner_unlimited?: boolean } | null;
  summaryError?: { code?: string; message: string };
  usage?: { model: string | null; input_tokens: number | string; output_tokens: number | string; calls?: number }[];
  usageError?: { code?: string; message: string };
  topups?: { usd_added: number | string }[];
  org?: string | null;
  owner?: string | null;
  noticeRows?: unknown[];
  noticeError?: boolean;
  memberships?: Record<string, unknown[]>;
}

function fakeDb(f: Fake) {
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const upserts: Record<string, unknown>[] = [];
  const db = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (fn === "ai_org_summary") return f.summaryError ? { data: null, error: f.summaryError } : { data: f.summary === undefined ? [{ clients: 100, coaches: 1, billing_exempt: false, ai_scale: null, owner_unlimited: false }] : f.summary ? [f.summary] : [], error: null };
      if (fn === "ai_org_month_usage") return f.usageError ? { data: null, error: f.usageError } : { data: f.usage ?? [], error: null };
      return { data: null, error: null };
    },
    from: (table: string) => {
      let step = 0;
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.in = () => chain;
      chain.order = () => chain;
      chain.limit = () => {
        step += 1;
        if (table === "organization_memberships") return Promise.resolve({ data: f.org ? [{ organization_id: f.org }] : [], error: null });
        return Promise.resolve({ data: (f.memberships?.[`${table}:${step}`] ?? f.memberships?.[table] ?? []) as unknown[], error: null });
      };
      chain.maybeSingle = () => Promise.resolve({ data: table === "organizations" ? (f.owner ? { owner_id: f.owner } : null) : null, error: null });
      chain.upsert = (row: Record<string, unknown>) => {
        upserts.push(row);
        const res = { data: f.noticeError ? null : (f.noticeRows ?? [{ level: row.level }]), error: f.noticeError ? { message: "x" } : null };
        return { select: () => Promise.resolve(res) };
      };
      // ai_budget_topups is read with select().eq().eq() and awaited
      chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: table === "ai_budget_topups" ? (f.topups ?? []) : [], error: null }).then(resolve);
      return chain;
    },
  };
  return { db: db as never, rpcCalls, upserts };
}

beforeEach(() => {
  sent.length = 0;
  stripeOn = false;
  resetBudgetLogForTests();
  delete process.env.STRIPE_PRICE_AI_TOPUP_5;
  delete process.env.STRIPE_PRICE_AI_TOPUP_10;
});

const sonnet = (inM: number, outM: number) => ({ model: "claude-sonnet-5", input_tokens: inM * 1_000_000, output_tokens: outM * 1_000_000 });

describe("getOrgBudgetStatus: one pool per organization", () => {
  it("prices the whole organization's month of logged tokens against $25 per 100 clients", async () => {
    // 1M in + 1M out on Sonnet = $12 of a $25 budget -> 48 percent
    const { db } = fakeDb({ usage: [sonnet(1, 1)] });
    expect(await getOrgBudgetStatus(db, "org1")).toMatchObject({ spentUsd: 12, budgetUsd: 25, pct: 48, level: "ok", organizationId: "org1" });
  });
  it("a gym: steps by all its clients plus $5 for each extra coach", async () => {
    const { db } = fakeDb({ summary: { clients: 250, coaches: 4 }, usage: [] });
    expect((await getOrgBudgetStatus(db, "org1"))?.budgetUsd).toBe(90);
  });
  it("a free-access organization gets the beta scale unless it has its own scale", async () => {
    expect((await getOrgBudgetStatus(fakeDb({ summary: { clients: 500, coaches: 1, billing_exempt: true } }).db, "o"))?.budgetUsd).toBe(7.5);
    expect((await getOrgBudgetStatus(fakeDb({ summary: { clients: 100, coaches: 1, billing_exempt: true, ai_scale: 1 } }).db, "o"))?.budgetUsd).toBe(25);
  });
  it("this month's paid top-ups raise the budget and can lift a pause", async () => {
    const usage = [sonnet(0, 2.5)]; // $25 of $25: out
    expect((await getOrgBudgetStatus(fakeDb({ usage }).db, "o"))?.level).toBe("out");
    const lifted = await getOrgBudgetStatus(fakeDb({ usage, topups: [{ usd_added: "3.5" }] }).db, "o");
    expect(lifted).toMatchObject({ budgetUsd: 28.5, level: "low", topUpsUsd: 3.5 });
    expect((await getOrgBudgetStatus(fakeDb({ usage, topups: [{ usd_added: 3.5 }, { usd_added: 7 }] }).db, "o"))?.budgetUsd).toBe(35.5);
  });
  it("is low at 80 percent and out at 100", async () => {
    expect((await getOrgBudgetStatus(fakeDb({ usage: [sonnet(0, 2)] }).db, "o"))?.level).toBe("low");
    expect((await getOrgBudgetStatus(fakeDb({ usage: [sonnet(0, 2.5)] }).db, "o"))?.level).toBe("out");
  });
  it("rolls over on the 1st (UTC): it asks only for use and top-ups since the start of the current UTC month", async () => {
    const { db, rpcCalls } = fakeDb({ usage: [] });
    await getOrgBudgetStatus(db, "o", new Date("2026-11-01T00:00:01Z"));
    expect(rpcCalls.find((c) => c.fn === "ai_org_month_usage")?.args.p_since).toBe("2026-11-01T00:00:00.000Z");
    expect(monthStartIso(new Date("2026-10-31T23:59:59Z"))).toBe("2026-10-01T00:00:00.000Z");
    expect(monthStartDate(new Date("2026-10-31T23:59:59Z"))).toBe("2026-10-01");
  });
  it("counts each call once: usage rows are already one per model and the cost is their sum", async () => {
    const usage = [
      { model: "claude-sonnet-5", input_tokens: 500_000, output_tokens: 100_000 },
      { model: "claude-haiku-5-5", input_tokens: 1_000_000, output_tokens: 0 },
    ];
    // Sonnet: 0.5M in x $2 + 0.1M out x $10 = $2.00; Haiku 5.5: 1M in x $0.10 = $0.10
    expect((await getOrgBudgetStatus(fakeDb({ usage }).db, "o"))?.spentUsd).toBeCloseTo(2.1, 6);
  });
  it("an internal unlimited owner means the whole organization is unlimited", async () => {
    const s = await getOrgBudgetStatus(fakeDb({ summary: { clients: 1, coaches: 1, owner_unlimited: true } }).db, "o");
    expect(s?.level).toBe("unlimited");
  });
});

describe("failing open, and saying so", () => {
  it("returns null so the caller carries on when the budget functions are missing (Release N not pasted): and does not log it", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const s = await getOrgBudgetStatus(fakeDb({ summaryError: { code: "PGRST202", message: "Could not find the function public.ai_org_summary" } }).db, "o");
    expect(s).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  it("returns null and LOGS once per organization per hour for any other failure, so a broken budget shows in the logs", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = { usageError: { code: "57014", message: "statement timeout" } };
    expect(await getOrgBudgetStatus(fakeDb(bad).db, "o", new Date("2026-10-08T10:00:00Z"))).toBeNull();
    expect(await getOrgBudgetStatus(fakeDb(bad).db, "o", new Date("2026-10-08T10:20:00Z"))).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain("organization o");
    expect(await getOrgBudgetStatus(fakeDb(bad).db, "o", new Date("2026-10-08T11:30:00Z"))).toBeNull();
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
  it("logBudgetProblem rate-limits per organization", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(logBudgetProblem("a", "x", "m", 1000)).toBe(true);
    expect(logBudgetProblem("a", "x", "m", 2000)).toBe(false);
    expect(logBudgetProblem("b", "x", "m", 2000)).toBe(true);
    spy.mockRestore();
  });
});

describe("getCoachBudgetStatus", () => {
  it("finds the coach's organization and reports its pool", async () => {
    const { db } = fakeDb({ org: "org9", usage: [sonnet(1, 1)] });
    expect((await getCoachBudgetStatus(db, "coach1"))?.organizationId).toBe("org9");
  });
  it("is null for a coach with no organization", async () => {
    expect(await getCoachBudgetStatus(fakeDb({ org: null }).db, "coach1")).toBeNull();
    expect(await resolveOrg(fakeDb({ org: null }).db, "c")).toBeNull();
  });
});

describe("resolveBillingCoach", () => {
  it("is the person themselves when they are a coach", async () => {
    const { db } = fakeDb({ memberships: { "group_memberships:1": [{ profile_id: "c1" }] } });
    expect(await resolveBillingCoach(db, "c1")).toBe("c1");
  });
  it("is null for a person with no coach and no groups", async () => {
    expect(await resolveBillingCoach(fakeDb({ memberships: { "group_memberships:1": [] } }).db, "client")).toBeNull();
  });
});

describe("noteBudgetLevel: the owner and the coach who crossed the line, once", () => {
  it("records the notice for the organization and pushes the plain message to the owner and the coach", async () => {
    const { db, upserts } = fakeDb({ org: "org1", owner: "owner1", noticeRows: undefined });
    expect(await noteBudgetLevel(db, "coach1", "low", new Date("2026-10-20T12:00:00Z"))).toBe(true);
    expect(upserts[0]).toMatchObject({ organization_id: "org1", month: "2026-10-01", level: "low" });
    expect(sent.map((s) => s.profileId).sort()).toEqual(["coach1", "owner1"]);
    expect(sent[0].body).toContain("almost used up");
  });
  it("a solo coach (the owner is the coach) is told once, not twice", async () => {
    const { db } = fakeDb({ org: "org1", owner: "coach1" });
    await noteBudgetLevel(db, "coach1", "out");
    expect(sent.map((s) => s.profileId)).toEqual(["coach1"]);
  });
  it("does nothing the second time (the record already exists, so no row comes back)", async () => {
    const { db } = fakeDb({ org: "org1", owner: "o", noticeRows: [] });
    expect(await noteBudgetLevel(db, "c", "out")).toBe(false);
    expect(sent).toHaveLength(0);
  });
  it("never throws if recording fails, or if the coach has no organization", async () => {
    expect(await noteBudgetLevel(fakeDb({ org: "o", owner: "x", noticeError: true }).db, "c", "out")).toBe(false);
    expect(await noteBudgetLevel(fakeDb({ org: null }).db, "c", "out")).toBe(false);
  });
});

describe("whether a top-up can really be bought", () => {
  it("is off while payments are off", () => {
    expect(aiTopUpPurchasable()).toBe(false);
    expect(topUpInfo(new Date("2026-10-08T00:00:00Z"))).toMatchObject({ available: false, resetsOn: "November 1" });
    expect(resetsOnText(new Date("2026-12-15T00:00:00Z"))).toBe("January 1");
  });
  it("is off when payments are on but no top-up price is set (nothing could be bought)", () => {
    stripeOn = true;
    expect(aiTopUpPurchasable()).toBe(false);
  });
  it("is on only when payments are on AND a top-up price is set", () => {
    stripeOn = true;
    process.env.STRIPE_PRICE_AI_TOPUP_5 = "price_123";
    expect(aiTopUpPurchasable()).toBe(true);
    expect(topUpInfo().available).toBe(true);
  });
});

describe("topUpInfo names only the packs that can really be bought and would lift the pause", () => {
  const status = (level: "ok" | "low" | "out", spentUsd: number, budgetUsd: number) => ({ level, spentUsd, budgetUsd, pct: 0, unlimited: false, organizationId: "o", topUpsUsd: 0 });
  it("nothing is offered while payments are off", () => {
    expect(topUpInfo(new Date(), status("out", 25, 25))).toMatchObject({ available: false, packs: [], wouldNotCover: false });
  });
  it("only a pack whose price is set is named", () => {
    stripeOn = true;
    process.env.STRIPE_PRICE_AI_TOPUP_10 = "price_10";
    const info = topUpInfo(new Date(), status("low", 21, 25));
    expect(info.packs.map((p) => p.cents)).toEqual([1000]);
    expect(info.available).toBe(true);
  });
  it("a used-up coach is offered only the packs that bring the month back under budget", () => {
    stripeOn = true;
    process.env.STRIPE_PRICE_AI_TOPUP_5 = "price_5";
    process.env.STRIPE_PRICE_AI_TOPUP_10 = "price_10";
    // spent 25.00 of 25: both lift it
    expect(topUpInfo(new Date(), status("out", 25, 25)).packs.map((p) => p.cents)).toEqual([500, 1000]);
    // spent 29.00 of 25: the $3.50 pack (to 28.50) is not enough, the $7 pack (to 32) is
    expect(topUpInfo(new Date(), status("out", 29, 25)).packs.map((p) => p.cents)).toEqual([1000]);
  });
  it("when no pack is big enough it says so instead of claiming top-ups are not open", () => {
    stripeOn = true;
    process.env.STRIPE_PRICE_AI_TOPUP_5 = "price_5";
    process.env.STRIPE_PRICE_AI_TOPUP_10 = "price_10";
    expect(topUpInfo(new Date(), status("out", 40, 25))).toMatchObject({ available: false, packs: [], wouldNotCover: true });
  });
});
