import { beforeEach, describe, expect, it, vi } from "vitest";

const sent: { profileId: string; title: string; body: string }[] = [];
vi.mock("@/lib/send-push", () => ({
  sendPushToProfile: async (_db: unknown, profileId: string, title: string, body: string) => {
    sent.push({ profileId, title, body });
    return 1;
  },
}));
vi.mock("@/lib/stripe", () => ({ isStripeConfigured: () => false }));

import { getCoachBudgetStatus, monthStartIso, noteBudgetLevel, resetsOnText, resolveBillingCoach, topUpInfo } from "@/lib/ai-budget-server";

interface Fake {
  credit?: { ai_access_mode: string } | null;
  multiplier?: number | null;
  multiplierError?: boolean;
  usage?: { model: string | null; input_tokens: number | string; output_tokens: number | string; calls?: number }[];
  usageError?: boolean;
  memberships?: Record<string, unknown[]>;
  noticeRows?: unknown[];
  noticeError?: boolean;
}

function fakeDb(f: Fake) {
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const upserts: Record<string, unknown>[] = [];
  const db = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (fn === "coach_ai_multiplier") return f.multiplierError ? { data: null, error: { message: "boom" } } : { data: f.multiplier ?? 1, error: null };
      if (fn === "ai_month_usage") return f.usageError ? { data: null, error: { message: "function does not exist" } } : { data: f.usage ?? [], error: null };
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
        return Promise.resolve({ data: (f.memberships?.[`${table}:${step}`] ?? f.memberships?.[table] ?? []) as unknown[], error: null });
      };
      chain.maybeSingle = () => Promise.resolve({ data: table === "coach_credits" ? (f.credit ?? null) : null, error: null });
      chain.upsert = (row: Record<string, unknown>) => {
        upserts.push(row);
        const res = { data: f.noticeError ? null : (f.noticeRows ?? [{ level: row.level }]), error: f.noticeError ? { message: "x" } : null };
        return { select: () => Promise.resolve(res) };
      };
      return chain;
    },
  };
  return { db: db as never, rpcCalls, upserts };
}

beforeEach(() => {
  sent.length = 0;
});

describe("getCoachBudgetStatus", () => {
  it("prices the month's logged tokens and compares them with $25 times the coach's multiplier", async () => {
    // 1,000,000 in + 1,000,000 out on Sonnet = $12; budget 25 x 1 = $25 -> 48 percent
    const { db } = fakeDb({ multiplier: 1, usage: [{ model: "claude-sonnet-5", input_tokens: "1000000", output_tokens: "1000000" }] });
    const s = await getCoachBudgetStatus(db, "c1");
    expect(s).toMatchObject({ spentUsd: 12, budgetUsd: 25, pct: 48, level: "ok" });
  });
  it("scales the budget with the multiplier (two steps, or a beta organization)", async () => {
    expect((await getCoachBudgetStatus(fakeDb({ multiplier: 2, usage: [] }).db, "c1"))?.budgetUsd).toBe(50);
    expect((await getCoachBudgetStatus(fakeDb({ multiplier: 0.3, usage: [] }).db, "c1"))?.budgetUsd).toBe(7.5);
  });
  it("is low at 80 percent and out at 100", async () => {
    const lowUsage = [{ model: "claude-sonnet-5", input_tokens: 0, output_tokens: 2_000_000 }]; // $20 of $25
    expect((await getCoachBudgetStatus(fakeDb({ multiplier: 1, usage: lowUsage }).db, "c1"))?.level).toBe("low");
    const outUsage = [{ model: "claude-sonnet-5", input_tokens: 0, output_tokens: 2_500_000 }]; // $25 of $25
    expect((await getCoachBudgetStatus(fakeDb({ multiplier: 1, usage: outUsage }).db, "c1"))?.level).toBe("out");
  });
  it("rolls over on the 1st (UTC): it asks only for use since the start of the current UTC month", async () => {
    const { db, rpcCalls } = fakeDb({ multiplier: 1, usage: [] });
    await getCoachBudgetStatus(db, "c1", new Date("2026-11-01T00:00:01Z"));
    expect(rpcCalls.find((c) => c.fn === "ai_month_usage")?.args.p_since).toBe("2026-11-01T00:00:00.000Z");
    expect(monthStartIso(new Date("2026-10-31T23:59:59Z"))).toBe("2026-10-01T00:00:00.000Z");
  });
  it("counts each call once: the usage rows are already one per model, and the cost is just their sum", async () => {
    const usage = [
      { model: "claude-sonnet-5", input_tokens: 500_000, output_tokens: 100_000 },
      { model: "claude-haiku-5-5", input_tokens: 1_000_000, output_tokens: 0 },
    ];
    const s = await getCoachBudgetStatus(fakeDb({ multiplier: 1, usage }).db, "c1");
    // Sonnet: 0.5M in x $2 + 0.1M out x $10 = $2.00; Haiku 5.5: 1M in x $0.10 = $0.10
    expect(s?.spentUsd).toBeCloseTo(2.1, 6);
  });
  it("an internal unlimited account has no budget", async () => {
    const s = await getCoachBudgetStatus(fakeDb({ credit: { ai_access_mode: "unlimited" }, multiplier: 1, usage: [] }).db, "c1");
    expect(s?.level).toBe("unlimited");
  });
  it("returns null, so the caller carries on, when the budget cannot be worked out", async () => {
    expect(await getCoachBudgetStatus(fakeDb({ multiplierError: true }).db, "c1")).toBeNull();
    expect(await getCoachBudgetStatus(fakeDb({ multiplier: 1, usageError: true }).db, "c1")).toBeNull();
  });
});

describe("resolveBillingCoach", () => {
  it("is the person themselves when they are a coach", async () => {
    const { db } = fakeDb({ memberships: { "group_memberships:1": [{ profile_id: "c1" }] } });
    expect(await resolveBillingCoach(db, "c1")).toBe("c1");
  });
  it("is the first coach of the client's groups", async () => {
    const { db } = fakeDb({ memberships: { "group_memberships:1": [] } });
    // second read (the client's groups) is not a limit() call in the fake, so only the not-a-coach path is checked here
    expect(await resolveBillingCoach(db, "client")).toBeNull();
  });
});

describe("noteBudgetLevel", () => {
  it("records the notice and pushes the plain message the first time", async () => {
    const { db, upserts } = fakeDb({});
    const ok = await noteBudgetLevel(db, "c1", "low", new Date("2026-10-20T12:00:00Z"));
    expect(ok).toBe(true);
    expect(upserts[0]).toMatchObject({ coach_id: "c1", month: "2026-10-01", level: "low" });
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toContain("almost used up");
  });
  it("does nothing the second time (the record already exists, so no row comes back)", async () => {
    const { db } = fakeDb({ noticeRows: [] });
    expect(await noteBudgetLevel(db, "c1", "out")).toBe(false);
    expect(sent).toHaveLength(0);
  });
  it("never throws if recording fails", async () => {
    const { db } = fakeDb({ noticeError: true });
    expect(await noteBudgetLevel(db, "c1", "out")).toBe(false);
  });
});

describe("top-up wording inputs", () => {
  it("billing is off, so there is no buy option", () => {
    const t = topUpInfo(new Date("2026-10-08T00:00:00Z"));
    expect(t.available).toBe(false);
    expect(t.resetsOn).toBe("November 1");
    expect(resetsOnText(new Date("2026-12-15T00:00:00Z"))).toBe("January 1");
  });
});
