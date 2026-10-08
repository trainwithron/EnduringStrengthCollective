import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiRateLimitedError, USER_MONTHLY_CEILING, userMonthlyCeilingFor } from "@/lib/ai-usage";

// A fake service-role client: the person's log count this month, and what reserve_ai_call answers.
let logCount = 0;
let countError: { message: string } | null = null;
const rpc = vi.fn(async () => ({ data: [{ log_id: "log-1", denied_reason: null }], error: null }));
const from = vi.fn(() => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.gte = () => Promise.resolve({ count: logCount, error: countError });
  chain.update = () => chain;
  return chain;
});
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc, from }) }));

import { reserveAiCall } from "@/lib/ai-usage-server";

beforeEach(() => {
  logCount = 0;
  countError = null;
  rpc.mockClear();
  from.mockClear();
});

describe("per-person monthly ceilings", () => {
  it("sets generous, tunable ceilings for food photos and typed estimates only", () => {
    expect(USER_MONTHLY_CEILING).toEqual({ food_photo_parse: 90, food_log_parse: 300 });
    expect(userMonthlyCeilingFor("food_photo_parse")).toBe(90);
    expect(userMonthlyCeilingFor("food_log_parse")).toBe(300);
    expect(userMonthlyCeilingFor("program_generation")).toBeNull();
  });

  it("lets a person under their ceiling through", async () => {
    logCount = 89;
    const handle = await reserveAiCall({ feature: "food_photo_parse", userId: "u1" });
    expect(handle).toBeTruthy();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("stops a person at their ceiling before the model is reached, with the friendly message", async () => {
    logCount = 90;
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
