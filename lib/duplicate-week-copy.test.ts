import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateCopyProgression, generateLinearProgression } from "@/lib/progression-models";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("duplicate a week without progressions", () => {
  it("copy as is gives every new week the source weight and reps, where a progression changes them", () => {
    const source = { weight: 185, reps: 5, repMin: null, repMax: null };
    expect(generateCopyProgression(source, { weeks: 3 })).toEqual([
      { weight: 185, reps: 5 },
      { weight: 185, reps: 5 },
      { weight: 185, reps: 5 },
    ]);
    expect(generateLinearProgression(source, { weeks: 2, weightPctIncreasePerWeek: 2.5 })[0].weight).not.toBe(185);
    // a set with no weight stays without one
    expect(generateCopyProgression({ weight: null, reps: 12, repMin: null, repMax: null }, { weeks: 1 })).toEqual([{ weight: null, reps: 12 }]);
  });
  it("the panel offers it first, leaves class rep targets and interval changes out of it, and says what it copies", () => {
    const panel = src("components/coach/desktop/duplicate-week-panel.tsx");
    expect(panel).toContain('type Model = "copy" | "linear" | "double" | "undulating" | "percent_tm";');
    expect(panel).toContain('(["copy", "linear", "double", "undulating", "percent_tm"] as Model[])');
    expect(panel).toContain('useState<Model>("copy")'); // a plain copy is the starting choice
    expect(panel).toContain('results = generateCopyProgression(source, { weeks: weekCount });');
    expect(panel).toContain('amountPerWeek: model === "copy" ? 0 :');
    expect(panel).toContain('model !== "copy" && !isDistancePace && classRepsEnabled');
    expect(panel).toContain("Nothing is progressed.");
  });
  it("the ongoing Exercise Progressions rules are not part of a duplicated week (they belong to the program, not to a week)", () => {
    const panel = src("components/coach/desktop/duplicate-week-panel.tsx");
    expect(panel).not.toContain("exercise_progressions");
  });
});
