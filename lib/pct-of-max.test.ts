import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { maxByLift, parseWeightCell, pctText, setWeightFor, weightFromPct } from "./pct-of-max";
import { cellWrite } from "./cell-write";

// Wave 2 T3 (Ron, Nov 20): "% of max" in team programs. The coach writes 75%; each athlete sees their own weight from their max (the locked tested max, else the estimate),
// rounded to the plate step.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("the coach's weight box", () => {
  it("75% is a percent of max, a plain number a fixed weight, empty clears both", () => {
    expect(parseWeightCell("75%")).toEqual({ pct: 75, weight: null });
    expect(parseWeightCell(" 82.5 % ")).toEqual({ pct: 82.5, weight: null });
    expect(parseWeightCell("185")).toEqual({ pct: null, weight: 185 });
    expect(parseWeightCell("")).toEqual({ pct: null, weight: null });
    expect(parseWeightCell("0%")).toBeNull();
    expect(parseWeightCell("151%")).toBeNull();
  });
  it("saves one and clears the other, in the database and on screen", () => {
    expect(cellWrite("weight", "75%")).toEqual({ patch: { target_weight: null, target_pct_max: 75 }, local: { targetWeight: null, targetPctMax: 75 } });
    expect(cellWrite("weight", "185")).toEqual({ patch: { target_weight: 185, target_pct_max: null }, local: { targetWeight: 185, targetPctMax: null } });
    expect(pctText(75)).toBe("75%");
    expect(read("components/coach/exercise-builder-card.tsx")).toContain('if (field === "weight" && set.targetWeight == null && set.targetPctMax != null) return pctText(set.targetPctMax);');
  });
  it("'Use the suggested weights' never replaces a percent", () => {
    expect(read("components/coach/exercise-builder-card.tsx")).toContain("s.targetWeight === null && s.targetPctMax == null && suggestedWeights?.[s.id] !== undefined");
  });
});

describe("each athlete's own weight", () => {
  const maxes = maxByLift([{ exercise_name: "Back Squat", estimated_max: 245 }, { exercise_name: "Bench Press", estimated_max: "0" }]);
  it("the percent of their max, to the nearest 5 lb; no max, no number", () => {
    expect(weightFromPct(75, 245)).toBe(185); // 183.75
    expect(weightFromPct(80, 300)).toBe(240);
    expect(setWeightFor({ targetWeight: null, targetPctMax: 75 }, " back squat ", maxes)).toBe(185);
    expect(setWeightFor({ targetWeight: null, targetPctMax: 75 }, "Bench Press", maxes)).toBeNull();
    expect(setWeightFor({ targetWeight: null, targetPctMax: 75 }, "Deadlift", maxes)).toBeNull();
  });
  it("a fixed weight always wins", () => {
    expect(setWeightFor({ targetWeight: 135, targetPctMax: 75 }, "Back Squat", maxes)).toBe(135);
  });
  it("is shown in the workout logger and in the workout preview, from this athlete's own maxes", () => {
    const logger = read("app/sessions/[sessionId]/page.tsx");
    expect(logger).toContain('supabase.from("athlete_training_maxes").select("exercise_name, estimated_max").eq("athlete_id", session.athlete_id)');
    expect(logger).toContain("weight: setWeightFor(");
    expect(logger).toContain("target_reps, target_weight, target_pct_max");
    const overview = read("lib/workout-overview-data.ts");
    expect(overview).toContain('supabase.from("athlete_training_maxes").select("exercise_name, estimated_max").eq("athlete_id", athleteId)');
    expect(overview).toContain("targetWeight: setWeightFor(st, ex.exerciseName, athleteMaxes)");
  });
});

describe("the printed team sheet", () => {
  it("says the percent, and prints each athlete's own weight by their name on the paper sheet only", () => {
    const load = read("lib/team-sheet/load-sheet.ts");
    expect(load).toContain("target_distance, target_pct_max )");
    expect(load).toContain("pct != null ? `${p.text} @${pctText(pct)}` : p.text");
    expect(load).toContain('supabase.from("athlete_training_maxes").select("athlete_id, exercise_name, estimated_max").in("athlete_id", ids)');
    const pdf = read("lib/team-sheet/export-pdf.ts");
    expect(pdf).toContain("const own = c.exerciseId ? model.targets?.[a.id]?.[c.exerciseId] : undefined;");
    // the Excel sheet's boxes are read back as what was lifted: no number goes in them
    expect(read("lib/team-sheet/export-xlsx.ts")).not.toContain("targets");
  });
});

describe("a percent survives every copy", () => {
  it("adding a set, copying an exercise, restoring a program and duplicating weeks keep it (copying a program is in the database, step 216)", () => {
    const card = read("components/coach/exercise-builder-card.tsx");
    expect(card).toContain("target_pct_max: last?.targetPctMax ?? null,");
    expect(card).toContain("target_pct_max: s.targetPctMax ?? null,");
    expect(read("lib/program-restore.ts")).toContain("target_pct_max: st.targetPctMax ?? null,");
    const weeks = read("components/coach/desktop/duplicate-week-panel.tsx");
    expect(weeks).toContain("target_pct_max: st.targetPctMax ?? null,");
    expect(weeks).toContain("target_pct_max: track.otherTargets.pctMax ?? null,");
    expect(read("lib/exercise-fields.ts")).toContain("set_type, target_pct_max\";");
    expect(read("supabase/migrations/0460_percent_of_max.sql")).toContain("target_pace, set_type, target_pct_max");
  });
});
