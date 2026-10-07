import { describe, expect, it } from "vitest";
import { computeBaseline, type BaselineInput, type BaselineResult } from "@/lib/nutrition-baseline";

const base: BaselineInput = { weightLbs: 150, heightCm: 165, sex: "female", dateOfBirth: "1996-01-01", bodyFatPct: null, activity: "moderate", phase: "fat_loss", todayKey: "2026-10-07" };
const ok = (i: BaselineInput): BaselineResult => {
  const r = computeBaseline(i);
  if (!r.ok) throw new Error(`expected a baseline, missing: ${r.missing.join(", ")}`);
  return r;
};

describe("a starting target from a worked profile", () => {
  it("female, 150 lb, 165 cm, 30, moderate, fat loss: Mifflin base 1401, maintenance 2172, minus 20 percent is 1738", () => {
    const r = ok(base);
    expect(r.bmr).toBe(1401);
    expect(r.maintenance).toBe(2172);
    expect(r.calories).toBe(1738);
    expect(r.proteinG).toBe(150);
    expect(r.phase).toBe("fat_loss");
    expect(r.floor).toBe(1401);
    expect(r.belowFloor).toBe(false);
    expect(r.formula).toBe("Mifflin-St Jeor");
    expect(r.ageYears).toBe(30);
    expect(r.rationale).toMatch(/nothing applies until you approve/i);
  });
  it("with body fat the Katch-McArdle base is used: 180 lb at 20 percent is 1781, maintenance 2761, muscle building plus 10 percent is 3037", () => {
    const r = ok({ ...base, weightLbs: 180, sex: "male", bodyFatPct: 20, phase: "hypertrophy" });
    expect(r.bmr).toBe(1781);
    expect(r.maintenance).toBe(2761);
    expect(r.calories).toBe(3037);
    expect(r.formula).toMatch(/Katch/);
  });
  it("sex not given: the average of the male and female formulas (1484) and it says so", () => {
    const r = ok({ ...base, sex: null });
    expect(r.bmr).toBe(1484);
    expect(r.formula).toMatch(/average/);
  });
  it("reverse diet is plus 5 percent and maintenance holds", () => {
    expect(ok({ ...base, phase: "reverse_diet" }).calories).toBe(2281);
    expect(ok({ ...base, phase: "maintenance" }).calories).toBe(2172);
  });
});

describe("a client under 18 never gets a deficit", () => {
  const teen: BaselineInput = { ...base, sex: "male", weightLbs: 160, heightCm: 175, dateOfBirth: "2010-01-01" };
  it("fat loss is held at maintenance and says why", () => {
    const r = ok(teen);
    expect(r.ageYears).toBe(16);
    expect(r.heldForAge).toBe(true);
    expect(r.phase).toBe("maintenance");
    expect(r.calories).toBe(2703);
    expect(r.rationale).toMatch(/under 18/);
  });
  it("muscle building is allowed for a teenager, and 18 on the birthday is an adult", () => {
    const bulk = ok({ ...teen, phase: "hypertrophy" });
    expect(bulk.heldForAge).toBe(false);
    expect(bulk.calories).toBeGreaterThan(2703);
    expect(ok({ ...teen, dateOfBirth: "2008-10-07" }).heldForAge).toBe(false);
    expect(ok({ ...teen, dateOfBirth: "2008-10-08" }).heldForAge).toBe(true);
  });
});

describe("what is missing", () => {
  it("names every missing input and makes no number", () => {
    expect(computeBaseline({ ...base, heightCm: null, weightLbs: null, dateOfBirth: null, activity: null })).toEqual({ ok: false, missing: ["height", "a weight", "date of birth", "activity level"] });
  });
  it("never guesses an age from a bad date", () => {
    expect(computeBaseline({ ...base, dateOfBirth: "2999-01-01" }).ok).toBe(false);
  });
});

describe("macros and the floor", () => {
  it("uses the client's own protein rule and a keto diet's carbs", () => {
    const r = ok({ ...base, phase: "maintenance", proteinGPerLb: 1.2, dietType: "keto" });
    expect(r.proteinG).toBe(180);
    expect(r.carbsG).toBe(25);
  });
  it("a lower-carb split moves calories from carbs to fat", () => {
    const bal = ok({ ...base, phase: "maintenance" });
    const low = ok({ ...base, phase: "maintenance", carbSplit: "low" });
    expect(low.carbsG).toBeLessThan(bal.carbsG);
    expect(low.fatG).toBeGreaterThan(bal.fatG);
  });
  it("a target under the floor is flagged but still computed", () => {
    const r = ok({ ...base, weightLbs: 110, heightCm: 150, activity: "sedentary", phase: "fat_loss", dateOfBirth: "1960-01-01" });
    expect(r.belowFloor).toBe(true);
    expect(r.rationale).toMatch(/estimated floor/);
  });
});
