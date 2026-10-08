import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiRateLimitedError, USER_MONTHLY_CEILING, userMonthlyCeilingFor } from "@/lib/ai-usage";

// A fake service-role client: the person's log count this month, and what reserve_ai_call answers.
let logCount = 0;
let countError: { message: string } | null = null;
const rpc = vi.fn(async () => ({ data: [{ log_id: "log-1", denied_reason: null }], error: null }));
const filters: string[] = [];
const from = vi.fn(() => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.neq = (column: string, value: string) => {
    filters.push(`${column}!=${value}`);
    return chain;
  };
  chain.gte = () => Promise.resolve({ count: logCount, error: countError });
  chain.update = () => chain;
  return chain;
});
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc, from }) }));

// The budget side is faked here (its own server functions are tested in ai-budget-server.test.ts): who the bill lands on, how far through the budget they are, and the notices.
let billingCoach: string | null = null;
let status: { level: "ok" | "low" | "out" | "unlimited"; spentUsd: number; budgetUsd: number; pct: number; unlimited: boolean } | null = null;
const noted: string[] = [];
vi.mock("@/lib/ai-budget-server", () => ({
  resolveBillingCoach: async () => billingCoach,
  getCoachBudgetStatus: async () => status,
  noteBudgetLevel: async (_db: unknown, _coach: string, level: string) => {
    noted.push(level);
    return true;
  },
  topUpInfo: () => ({ available: false, supportEmail: "help@enduringstrengthco.com", resetsOn: "November 1" }),
}));

import { reserveAiCall } from "@/lib/ai-usage-server";

beforeEach(() => {
  logCount = 0;
  countError = null;
  billingCoach = null;
  status = null;
  noted.length = 0;
  rpc.mockClear();
  from.mockClear();
});

const mk = (level: "ok" | "low" | "out" | "unlimited") => ({ level, spentUsd: 0, budgetUsd: 25, pct: 0, unlimited: level === "unlimited" });

describe("the coach's monthly AI budget", () => {
  it("lets a coach under budget through with no notice", async () => {
    billingCoach = "c1";
    status = mk("ok");
    await expect(reserveAiCall({ feature: "program_chat", userId: "c1" })).resolves.toBeTruthy();
    expect(noted).toEqual([]);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("tells the coach once as it runs low, and the call still goes ahead", async () => {
    billingCoach = "c1";
    status = mk("low");
    await expect(reserveAiCall({ feature: "program_chat", userId: "c1" })).resolves.toBeTruthy();
    expect(noted).toEqual(["low"]);
  });

  it("pauses a coach's own AI request when the budget is used up, with the plain-spoken message, and never reaches the model", async () => {
    billingCoach = "c1";
    status = mk("out");
    await expect(reserveAiCall({ feature: "program_generation", userId: "c1" })).rejects.toMatchObject({ reason: "budget_out" });
    const err = (await reserveAiCall({ feature: "program_generation", userId: "c1" }).catch((e) => e)) as AiRateLimitedError;
    expect(err.message).toContain("Your AI for this month is used up, so AI features are paused until November 1.");
    expect(err.message).toContain("I'm running a small business");
    expect(err.message).toContain("help@enduringstrengthco.com");
    expect(rpc).not.toHaveBeenCalled();
    expect(noted).toContain("out");
  });

  it("shows a CLIENT only the friendly pause line, never the business explanation", async () => {
    billingCoach = "c1";
    status = mk("out");
    const err = (await reserveAiCall({ feature: "food_photo_parse", userId: "client-9" }).catch((e) => e)) as AiRateLimitedError;
    expect(err.reason).toBe("budget_out");
    expect(err.message).toBe("AI photo and typed logging is paused for this month. You can still search foods, scan a barcode or use your saved meals.");
    expect(err.message).not.toMatch(/money|business|top-up/i);
  });

  it("counts nightly jobs and the spotters against the coach they belong to: a job with a coach and no person is refused as 'budget_out' (the caller skips it)", async () => {
    billingCoach = "c1";
    status = mk("out");
    const err = (await reserveAiCall({ feature: "coach_briefing", coachId: "c1" }).catch((e) => e)) as AiRateLimitedError;
    expect(err.reason).toBe("budget_out");
    expect(err.message).toContain("paused until November 1");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("leaves an internal unlimited account alone, however much it has used", async () => {
    billingCoach = "c1";
    status = mk("unlimited");
    await expect(reserveAiCall({ feature: "program_generation", userId: "c1" })).resolves.toBeTruthy();
    expect(noted).toEqual([]);
  });

  it("carries on under the other limits when the budget cannot be worked out (the database has no step 46 yet, or a read failed)", async () => {
    billingCoach = "c1";
    status = null;
    await expect(reserveAiCall({ feature: "program_chat", userId: "c1" })).resolves.toBeTruthy();
  });

  it("carries on when nobody's bill can be found (a platform admin's own call)", async () => {
    billingCoach = null;
    status = mk("out");
    await expect(reserveAiCall({ feature: "trivia_generate", userId: "admin" })).resolves.toBeTruthy();
  });
});

describe("per-person monthly ceilings", () => {
  it("sets generous, tunable ceilings for food photos and typed estimates only", () => {
    expect(USER_MONTHLY_CEILING).toEqual({ food_photo_parse: 150, food_log_parse: 300 });
    expect(userMonthlyCeilingFor("food_photo_parse")).toBe(150);
    expect(userMonthlyCeilingFor("food_log_parse")).toBe(300);
    expect(userMonthlyCeilingFor("program_generation")).toBeNull();
  });

  it("lets a person under their ceiling through", async () => {
    logCount = 149;
    const handle = await reserveAiCall({ feature: "food_photo_parse", userId: "u1" });
    expect(handle).toBeTruthy();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("stops a person at their ceiling before the model is reached, with the friendly message", async () => {
    logCount = 150;
    await expect(reserveAiCall({ feature: "food_photo_parse", userId: "u1" })).rejects.toMatchObject({
      reason: "user_monthly",
      message: "You've used this month's photo logs. You can still search foods, scan a barcode or use your saved meals.",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("applies the typed-estimate ceiling to typed estimates", async () => {
    logCount = 300;
    await expect(reserveAiCall({ feature: "food_log_parse", userId: "u1" })).rejects.toMatchObject({ reason: "user_monthly" });
    logCount = 299;
    await expect(reserveAiCall({ feature: "food_log_parse", userId: "u1" })).resolves.toBeTruthy();
  });

  it("does not count failed calls against the person (an outage or an unreadable photo is not theirs to pay for)", async () => {
    filters.length = 0;
    await reserveAiCall({ feature: "food_photo_parse", userId: "u1" });
    expect(filters).toContain("status!=error");
  });

  it("does not count or limit other features per person", async () => {
    logCount = 100000;
    await expect(reserveAiCall({ feature: "program_chat", userId: "u1" })).resolves.toBeTruthy();
    expect(from).not.toHaveBeenCalled();
  });

  it("refuses (fails closed) when the count cannot be read", async () => {
    countError = { message: "boom" };
    await expect(reserveAiCall({ feature: "food_photo_parse", userId: "u1" })).rejects.toBeInstanceOf(AiRateLimitedError);
    expect(rpc).not.toHaveBeenCalled();
  });
});
