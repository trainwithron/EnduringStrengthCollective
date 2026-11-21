import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseRepTarget, repTargetValue } from "@/lib/rep-target";
import { findCorrelatingWeightSuggestion } from "@/lib/set-suggestions";

// Ron, Nov 21 (a live workout): Dumbbell One Arm Row's reps box showed only "—", because the program's "12-15" was read as a plain number (it never worked for a range).
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("a rep target as written", () => {
  it('"12-15" suggests 12 and shows 12–15', () => {
    expect(parseRepTarget("12-15")).toEqual({ value: 12, hint: "12–15" });
  });
  it('"10-12" (and the other ways a range is written)', () => {
    expect(parseRepTarget("10-12")).toEqual({ value: 10, hint: "10–12" });
    expect(parseRepTarget("10 - 12")).toEqual({ value: 10, hint: "10–12" });
    expect(parseRepTarget("10–12")).toEqual({ value: 10, hint: "10–12" });
    expect(parseRepTarget("10 to 12")).toEqual({ value: 10, hint: "10–12" });
    expect(parseRepTarget("12-10")).toEqual({ value: 10, hint: "10–12" });
    expect(parseRepTarget("8-8")).toEqual({ value: 8, hint: "8" });
  });
  it('"8" works as before', () => {
    expect(parseRepTarget("8")).toEqual({ value: 8, hint: "8" });
    expect(parseRepTarget(8)).toEqual({ value: 8, hint: "8" });
  });
  it('"10+" and AMRAP keep their handling: no number suggested, no hint', () => {
    expect(parseRepTarget("10+")).toEqual({ value: null, hint: null });
    expect(parseRepTarget("AMRAP")).toEqual({ value: null, hint: null });
  });
  it("an empty target is nothing", () => {
    expect(parseRepTarget("")).toEqual({ value: null, hint: null });
    expect(parseRepTarget(null)).toEqual({ value: null, hint: null });
    expect(parseRepTarget(undefined)).toEqual({ value: null, hint: null });
    expect(parseRepTarget("0")).toEqual({ value: null, hint: null });
  });
});

describe("the logger", () => {
  it("the session page gives each set its low end as the target and the whole range as the hint", () => {
    const page = read("app/sessions/[sessionId]/page.tsx");
    expect(page).toContain("reps: parseRepTarget(t.target_reps).value,");
    expect(page).toContain("repsHint: parseRepTarget(t.target_reps).hint,");
    expect(page).toContain("targetRepsHint: target?.repsHint ?? null,");
    // the weight history is matched on the same number, so a range finds the last time it was trained
    expect(page).toContain("targetReps: repTargetValue(row.target_reps),");
    expect(read("lib/suggested-weights.ts")).toContain("const currentTargetReps = repTargetValue(set.targetReps);");
  });
  it("the reps box shows the range in grey and the done check fills the low end", () => {
    const grid = read("components/logging/exercise-set-grid.tsx");
    expect(grid).toContain('field === "reps" && set.targetRepsHint ? set.targetRepsHint : suggestionText ?? "—"');
    expect(grid).toContain("repTargetValue((set[TARGET_PROP.reps as keyof SetLogEntry] as number | string | null) ?? null)");
    // the weight box keeps "—" with nothing to suggest
    expect(grid).toContain('const placeholder = field === "rest" ? "m:ss" :');
  });
  it("a range now finds the weight from the last time that range was trained", () => {
    const history = [{ loggedAt: "2026-11-14T10:00:00Z", weight: 45, targetReps: repTargetValue("12-15"), targetRpe: null, targetRir: null }];
    expect(findCorrelatingWeightSuggestion(history, repTargetValue("12-15"))).toBe(45);
  });
});
