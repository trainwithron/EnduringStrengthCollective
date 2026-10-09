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
    expect(builder).toContain("parseRestInput(typed, field === \"time\" ? MAX_TIME_SECONDS : undefined)");
    expect(builder).toContain('(field === "rest" || field === "time") && typeof v === "number"');
    expect(builder).toContain("Rest looks like 5:00, 3m or 90s (up to 30:00).");
  });
  it("a bare small number asks before it is saved as seconds for Rest (never for Time), and a stored 0 shows as an empty cell", () => {
    expect(builder).toContain('parsed.bare && field !== "time" && !await confirmDialog(');
    expect(builder).toContain('v > 0 ? formatRest(v) : ""');
  });
  it("a refused or cancelled rest entry snaps the cell back to the saved value", () => {
    expect(builder).toContain("(await onCommit(draft)) === false) setDraft(value)");
    expect(builder).toMatch(/up to 30:00\)\."\);\s*return false;/);
    expect(builder).toContain("seconds?`)) return false;");
  });
  it("the client's own Rest cell keeps its unit: the shared label is 'Rest (s)'", () => {
    const fields = src("../../lib/exercise-fields.ts");
    expect(fields).toContain('{ key: "rest", label: "Rest (s)", kind: "number" }');
  });
  it("the interval generator writes no rest (null), never 0, when a generated week has none", () => {
    const dup = src("../coach/desktop/duplicate-week-panel.tsx");
    expect(dup).toContain("target_rest_seconds: result.restSeconds > 0 ? result.restSeconds : null,");
  });
});
