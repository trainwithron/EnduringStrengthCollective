import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { liftDisplayValue, liftStoredFromInput, liftCellText, formatLift, formatVolume, liftUnitLabel } from "@/lib/lift-weight";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("lifted weights are stored in pounds and shown in the person's unit", () => {
  it("before / after: what is stored and what a pounds client and a kilograms client see", () => {
    const stored = [45, 135, 225, 315, 12.5];
    expect(stored.map((lb) => liftCellText(lb, "lb"))).toEqual(["45", "135", "225", "315", "12.5"]);
    expect(stored.map((lb) => liftCellText(lb, "kg"))).toEqual(["20.4", "61.2", "102.1", "142.9", "5.7"]);
    expect(formatLift(135, "lb")).toBe("135 lb");
    expect(formatLift(135, "kg")).toBe("61.2 kg");
    expect(formatLift(null, "kg")).toBe("");
    expect(liftUnitLabel("kg")).toBe("kg");
  });
  it("a weight typed in kilograms is saved once as pounds (two decimals) and reads back the same in kilograms", () => {
    for (const kg of [20, 42.5, 60, 62, 100, 142.5]) {
      const lb = liftStoredFromInput(kg, "kg");
      expect(lb).toBe(Math.round((kg / 0.45359237) * 100) / 100);
      expect(liftDisplayValue(lb, "kg")).toBe(kg);
    }
    expect(liftStoredFromInput(135, "lb")).toBe(135);
  });
  it("volume is shown in the person's unit, rounded to a whole number", () => {
    expect(formatVolume(10000, "lb")).toBe("10,000 lb");
    expect(formatVolume(10000, "kg")).toBe("4,536 kg");
  });
});

describe("a cell that was only looked at keeps its stored pounds exactly", () => {
  it("the cell compares the typed kilograms with the shown kilograms and keeps the stored value when they match", () => {
    const cell = src("components/logging/exercise-set-grid.tsx");
    expect(cell).toContain("const same = typeof value === \"number\" && liftDisplayValue(value, unit) === checked.value;");
    expect(cell).toContain("commit(same ? (value as number) : liftStoredFromInput(checked.value, unit));");
    // the proof in numbers: 135 lb shows as 61.2 kg; leaving it alone must not turn 135 into 134.92
    expect(liftDisplayValue(135, "kg")).toBe(61.2);
    expect(liftStoredFromInput(61.2, "kg")).not.toBe(135);
  });
});

describe("wiring", () => {
  it("the workout screens and the overview read the unit of the person whose workout it is", () => {
    expect(src("app/sessions/[sessionId]/page.tsx")).toContain("<LiftUnitProvider unit={await loadLiftUnit(supabase, session.athlete_id)}>");
    const ov = src("components/logging/workout-overview-view.tsx");
    expect(ov).toContain("loadLiftUnit(await createServerClient(), athleteId)");
    expect(src("components/logging/pre-start-exercise-row.tsx")).toContain("formatLift(goal.weight, unit)");
    expect(src("components/logging/exercise-volume-history.tsx")).toContain("formatVolume(first.totalVolume, unit)");
    expect(src("components/logging/equipment-visual.tsx")).not.toContain("lbs");
  });
  it("the body weight asked for after a workout is read in the person's unit, not saved as pounds blindly", () => {
    const b = src("components/session/complete-workout-button.tsx");
    expect(b).toContain("parseWeightInput(weightValue, liftUnit)");
    expect(b).not.toContain("const value = Number(weightValue);");
  });
  it("the unit comes from the About you setting and falls back to pounds", () => {
    const s = src("lib/lift-unit-server.ts");
    expect(s).toContain("athlete_profile_details");
    expect(s).toContain('return "lb"');
  });
});
