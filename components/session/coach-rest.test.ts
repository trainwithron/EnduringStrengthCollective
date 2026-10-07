import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

// Ron's rule: when the coach gives a set a rest, the client gets ONLY that rest for that set: no picker, no extending it, no typed number replacing it.
describe("a coach-prescribed rest is the only option for that set", () => {
  const bar = src("./rest-timer-bar.tsx");
  const logger = src("../logging/session-logger.tsx");
  const grid = src("../logging/exercise-set-grid.tsx");
  const card = src("../logging/exercise-card.tsx");
  const builder = src("../coach/exercise-builder-card.tsx");

  it("the timer starts it by itself, says whose it is, and has no +15 s on it (Skip stays)", () => {
    expect(bar).toContain("pendingPrompt?.isPrescribed");
    expect(bar).toContain("(set by your coach)");
    expect(bar).toContain('running.source !== "coach" &&');
    expect(bar).toContain('running.source === "coach") return;');
    expect(bar).toContain("onClick={skip}");
  });
  it("the logger uses the coach's rest first; a number the client typed counts only when the coach set none; the 60/90/120 picker is untouched", () => {
    expect(logger).toContain('rest.source === "coach"');
    expect(logger).toContain("const typed = set.restSeconds ?? null;");
    expect(bar).toContain("const PRESETS = [60, 90, 120];");
  });
  it("the card works out the rest for the set that was just completed (an added set inherits the last prescribed one)", () => {
    expect(card).toContain("restForSet(exercise.sets, setId)");
  });
  it("the client's grid shows the coach's rest as a fixed time, not an input, and does not need it typed to complete the set", () => {
    expect(grid).toContain("set by your coach");
    expect(grid).toContain('field === "rest" && coachRest != null');
    expect(grid).toContain('(restPrescribed && f === "rest")');
  });
  it("the coach's rest cell takes 5:00, 300 or 90s and shows m:ss", () => {
    expect(builder).toContain("parseRestInput(typed)");
    expect(builder).toContain('field === "rest" && typeof v === "number"');
    expect(builder).toContain("Rest looks like 5:00, 300 or 90s.");
  });
});
