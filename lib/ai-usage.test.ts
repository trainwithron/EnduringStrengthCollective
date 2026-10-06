import { describe, it, expect } from "vitest";
import {
  allowanceLimit,
  allowanceRemaining,
  allowanceUsed,
  burstBucketFor,
  burstLimitFor,
  clientSteps,
  currentAllowancePeriod,
  isEnforced,
  monthlyCeilingFor,
  nextAllowanceReset,
  AI_BURST_LIMIT_PER_MINUTE,
  MEAL_SLOT_MONTHLY_CEILING_PER_STEP,
  aiMultiplier,
  aiInputTooLong,
  AI_INPUT_LIMITS,
} from "./ai-usage";

describe("burst policy", () => {
  it("uses the default limit for ordinary coach features", () => {
    expect(burstLimitFor("program_generation")).toBe(AI_BURST_LIMIT_PER_MINUTE);
    expect(isEnforced("program_chat")).toBe(true);
  });

  it("never limits system/automatic features", () => {
    expect(isEnforced("coach_briefing")).toBe(false);
    expect(isEnforced("spotter_overarching")).toBe(false);
    expect(isEnforced("session_pattern_check")).toBe(false);
  });

  it("gives per-meal calls their own looser bucket and a per-step monthly ceiling", () => {
    expect(burstLimitFor("meal_plan_slot")).toBeGreaterThan(AI_BURST_LIMIT_PER_MINUTE);
    expect(burstBucketFor("meal_plan_slot")).toEqual(["meal_plan_slot"]);
    expect(monthlyCeilingFor("meal_plan_slot")).toBe(MEAL_SLOT_MONTHLY_CEILING_PER_STEP);
    // Failed attempts are logged but not charged, so program generation has a ceiling of 1.5x its allowance.
    expect(monthlyCeilingFor("program_generation")).toBe(150);
  });

  it("shares one bucket across ordinary features, excluding meal slots and system calls", () => {
    const bucket = burstBucketFor("program_generation");
    expect(bucket).toContain("program_chat");
    expect(bucket).toContain("food_log_parse");
    expect(bucket).not.toContain("meal_plan_slot");
    expect(bucket).not.toContain("coach_briefing");
  });
});

describe("client-count steps", () => {
  it("is at least one step, then one per started 100 clients", () => {
    expect(clientSteps(0)).toBe(1);
    expect(clientSteps(1)).toBe(1);
    expect(clientSteps(100)).toBe(1);
    expect(clientSteps(101)).toBe(2);
    expect(clientSteps(150)).toBe(2);
    expect(clientSteps(200)).toBe(2);
    expect(clientSteps(201)).toBe(3);
  });

  it("scales the allowance: 100 clients = 100/200, 150 clients = 200/400", () => {
    expect(allowanceLimit("program_generation", 100)).toBe(100);
    expect(allowanceLimit("nutrition_plan", 100)).toBe(200);
    expect(allowanceLimit("program_generation", 150)).toBe(200);
    expect(allowanceLimit("nutrition_plan", 150)).toBe(400);
  });
});

describe("allowance", () => {
  const now = new Date("2026-10-15T12:00:00Z");

  it("period is the first of the UTC month and resets on the next first", () => {
    expect(currentAllowancePeriod(now)).toBe("2026-10-01");
    expect(currentAllowancePeriod(new Date("2026-10-31T23:59:59Z"))).toBe("2026-10-01");
    expect(currentAllowancePeriod(new Date("2026-11-01T00:00:00Z"))).toBe("2026-11-01");
    expect(nextAllowanceReset(now)).toBe("2026-11-01");
    expect(nextAllowanceReset(new Date("2026-12-20T00:00:00Z"))).toBe("2027-01-01");
  });

  it("a coach with no row, or a stale month, has the full allowance", () => {
    expect(allowanceRemaining("program_generation", null, 50, now)).toBe(100);
    expect(
      allowanceRemaining("nutrition_plan", { allowance_period: "2026-09-01", program_used: 5, mealplan_used: 150 }, 50, now)
    ).toBe(200);
  });

  it("subtracts this month's usage per action and floors at zero", () => {
    const row = { allowance_period: "2026-10-01", program_used: 12, mealplan_used: 250 };
    expect(allowanceUsed("program_generation", row, now)).toBe(12);
    expect(allowanceRemaining("program_generation", row, 100, now)).toBe(88);
    expect(allowanceRemaining("nutrition_plan", row, 100, now)).toBe(0);
    // more clients, bigger allowance, same usage
    expect(allowanceRemaining("nutrition_plan", row, 150, now)).toBe(150);
  });
});

describe("allowance scaling", () => {
  it("keeps one full step from 25 to 100 clients and one per 100 after that", () => {
    expect(aiMultiplier(25)).toBe(1);
    expect(aiMultiplier(100)).toBe(1);
    expect(aiMultiplier(101)).toBe(2);
    expect(aiMultiplier(250)).toBe(3);
  });

  it("gives a coach with few clients a prorated share, never below a quarter", () => {
    expect(aiMultiplier(0)).toBe(0.25);
    expect(aiMultiplier(5)).toBe(0.25);
    expect(aiMultiplier(10)).toBeCloseTo(0.4);
    expect(allowanceLimit("program_generation", 0)).toBe(25);
    expect(allowanceLimit("nutrition_plan", 0)).toBe(50);
  });

  it("free-access orgs get about 30 programs and 60 meal plans, whatever their client count", () => {
    expect(allowanceLimit("program_generation", 500, { exempt: true })).toBe(30);
    expect(allowanceLimit("nutrition_plan", 500, { exempt: true })).toBe(60);
  });

  it("an explicit org scale wins over everything", () => {
    expect(allowanceLimit("program_generation", 0, { exempt: true, scale: 0.1 })).toBe(10);
    expect(allowanceLimit("program_generation", 0, { scale: 2 })).toBe(200);
  });
});

describe("input length limits", () => {
  it("accepts text at the limit and rejects one character over", () => {
    const max = AI_INPUT_LIMITS.food_log_parse as number;
    expect(aiInputTooLong("food_log_parse", "a".repeat(max))).toBeNull();
    expect(aiInputTooLong("food_log_parse", "a".repeat(max + 1))).toMatch(/too long/);
  });
  it("names the limit in the message", () => {
    expect(aiInputTooLong("session_nl", "a".repeat(5000))).toContain(String(AI_INPUT_LIMITS.session_nl));
  });
  it("does not limit features with no cap set", () => {
    expect(aiInputTooLong("coach_briefing", "a".repeat(100000))).toBeNull();
  });
});
