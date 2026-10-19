import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// Oct 19 audit: one stray tap on Complete with nothing logged finished the day, posted an empty card and notified the coach (5 of 127 workout logs had zero sets).
describe("Complete with no sets logged asks once more", () => {
  const button = read("components/session/complete-workout-button.tsx");
  const logger = read("components/logging/session-logger.tsx");
  it("the logger counts the sets marked done and hands the count to the button", () => {
    expect(logger).toContain('ex.sets.filter((s) => s.status === "completed").length');
    expect(logger).toContain("completedSetCount={completedSetCount}");
  });
  it("with none, the first tap of Complete only asks 'No sets are logged yet. Complete anyway?'; the second, deliberate tap completes", () => {
    expect(button).toContain("if (completedSetCount === 0 && !emptyAsked) {\n                  setEmptyAsked(true);\n                  return;\n                }");
    expect(button).toContain('"No sets are logged yet. Complete anyway?"');
    expect(button).toContain('emptyAsked ? "Complete anyway" : "Complete workout"');
    // the question comes before anything is finished
    expect(button.indexOf("setEmptyAsked(true);")).toBeLessThan(button.indexOf("handleComplete();"));
  });
  it("Keep going closes the question, and a workout with sets completes in one tap as before", () => {
    expect(button).toContain("setConfirming(false);\n                setEmptyAsked(false);\n              }}");
    // a missing count (any other caller) never asks
    expect(button).toContain("completedSetCount?: number;");
  });
});
