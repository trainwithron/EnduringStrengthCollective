import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DAY_MAX_TOKENS, TOO_LONG_MESSAGE, TRUNCATED_RETRY_NOTE, buildDaySystemPrompt, readDayResult, truncatedRetryTimeoutMs } from "@/lib/ai-day-run";

// Live bug (Oct 13): every AI day for Rob Derrick failed "Couldn't build that day": the log showed status "truncated" with output_tokens exactly 3500, the cap, so the JSON was cut off.
const route = readFileSync(join(__dirname, "..", "app/api/ai/build-day/route.ts"), "utf8").replace(/\r\n/g, "\n");

describe("a long day is written, not cut off", () => {
  const longDay = {
    title: "Upper heavy",
    exercises: Array.from({ length: 10 }, (_, i) => ({ exerciseName: `Exercise number ${i + 1} with a long name`, sets: 4, reps: "8-10", weight: null, rpe: 8, rest: "2:00", timeSeconds: null })),
  };
  it("a 10-exercise day parses, and is a small fraction of the cap", () => {
    expect(readDayResult(longDay, "Day 1")?.exercises).toHaveLength(10);
    expect(JSON.stringify(longDay).length / 3).toBeLessThan(DAY_MAX_TOKENS / 4);
  });
  it("the cap is 8000, well above the 3500 that cut days off", () => {
    expect(DAY_MAX_TOKENS).toBe(8000);
    expect(route).toContain("maxTokens: DAY_MAX_TOKENS");
    expect(route).not.toContain("maxTokens: 3500");
  });
  it("the prompt asks for a compact answer", () => {
    expect(buildDaySystemPrompt({ youthBlock: null, hasInjury: false })).toContain("Keep the answer compact");
  });
  it("a cut-off day is written once more, shorter, with a friendly message if that is not possible", () => {
    expect(route).toContain("if (!(err instanceof AiTruncatedError)) throw err;");
    expect(route).toContain("attempt(TRUNCATED_RETRY_NOTE, retryTimeout)");
    expect(TRUNCATED_RETRY_NOTE).toContain("SHORTER");
    expect(TOO_LONG_MESSAGE).toBe("That day was too long to write. Try Resume, or ask for fewer exercises in a day.");
    expect(truncatedRetryTimeoutMs(10_000)).toBeGreaterThanOrEqual(15_000);
    expect(truncatedRetryTimeoutMs(45_000)).toBeNull();
  });
  it("a cut-off attempt is never charged and never counts as a built day", () => {
    const charge = route.indexOf("checkAndSpendCoachCredits(");
    const retry = route.indexOf("attempt(TRUNCATED_RETRY_NOTE");
    expect(retry).toBeGreaterThan(-1);
    expect(retry).toBeLessThan(charge);
    expect(route).toContain('.neq("status", "truncated")');
  });
});
