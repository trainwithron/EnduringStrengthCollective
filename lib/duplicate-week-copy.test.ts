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
  it("a one-click Duplicate week copies ONE week as is (Ron, Oct 29), the progressions panel starts at 1 week, and the copy leaves class rep targets and interval changes out of it, and says what it copies", () => {
    const panel = src("components/coach/desktop/duplicate-week-panel.tsx");
    expect(panel).toContain('type Model = "copy" | "linear" | "double" | "undulating" | "percent_tm";');
    expect(panel).toContain('onClick={() => void handleGenerate({ plain: true })}');
    expect(panel).toContain('const model: Model = opts?.plain ? "copy" : chosenModel;');
    expect(panel).toContain('const weekCount = opts?.plain ? 1 : Number(weeks);');
    expect(panel).toContain('Duplicate with progressions');
    expect(panel).toContain('useState("1")');
    expect(panel).toContain('results = generateCopyProgression(source, { weeks: weekCount });');
    expect(panel).toContain('amountPerWeek: model === "copy" ? 0 :');
    expect(panel).toContain('model !== "copy" && !isDistancePace && classRepsEnabled');
  });
  it("the ongoing Exercise Progressions rules are not part of a duplicated week (they belong to the program, not to a week)", () => {
    const panel = src("components/coach/desktop/duplicate-week-panel.tsx");
    expect(panel).not.toContain("exercise_progressions");
  });
});
