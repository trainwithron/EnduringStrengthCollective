import { describe, expect, it } from "vitest";
import { ageOnDate, asBiologicalSex, estimateBmr, estimateMaintenance } from "@/lib/nutrition-profile";

const full = { weightLbs: 180, heightCm: 180, sex: "male", dateOfBirth: "1996-10-07", bodyFatPct: null, todayKey: "2026-10-07" };

describe("age by date keys", () => {
  it("counts a birthday only once it is reached", () => {
    expect(ageOnDate("1996-10-07", "2026-10-07")).toBe(30);
    expect(ageOnDate("1996-10-08", "2026-10-07")).toBe(29);
    expect(ageOnDate("1996-10-06", "2026-10-07")).toBe(30);
    expect(ageOnDate("2008-02-29", "2026-02-28")).toBe(17);
  });
  it("is null for something that is not a date", () => {
    expect(ageOnDate("", "2026-10-07")).toBeNull();
    expect(ageOnDate("1996-10-07", "x")).toBeNull();
  });
});

describe("estimated BMR and maintenance from the client's own profile", () => {
  it("Mifflin-St Jeor for a worked profile (80.7 kg, 180 cm, 30, male): 10*81.6466 + 6.25*180 - 150 + 5", () => {
    // 180 lb = 81.64656 kg; 816.4656 + 1125 - 150 + 5 = 1796.4656
    expect(estimateBmr(full)).toBeCloseTo(1796.4656, 3);
  });
  it("Katch-McArdle when a body-fat percentage is on file", () => {
    // lean = 81.64656 * 0.8 = 65.317248; 370 + 21.6 * 65.317248 = 1780.85
    expect(estimateBmr({ ...full, bodyFatPct: 20 })).toBeCloseTo(1780.85, 1);
  });
  it("is null when any real input is missing (never a guessed age, height, weight or sex)", () => {
    expect(estimateBmr({ ...full, weightLbs: null })).toBeNull();
    expect(estimateBmr({ ...full, heightCm: null })).toBeNull();
    expect(estimateBmr({ ...full, sex: null })).toBeNull();
    expect(estimateBmr({ ...full, sex: "other" })).toBeNull();
    expect(estimateBmr({ ...full, dateOfBirth: null })).toBeNull();
  });
  it("maintenance is above BMR and null with no BMR", () => {
    const m = estimateMaintenance(full);
    expect(m).not.toBeNull();
    expect(m as number).toBeGreaterThan(estimateBmr(full) as number);
    expect(estimateMaintenance({ ...full, heightCm: null })).toBeNull();
  });
  it("reads a stored sex only when it is male or female", () => {
    expect(asBiologicalSex("male")).toBe("male");
    expect(asBiologicalSex("female")).toBe("female");
    expect(asBiologicalSex("x")).toBeNull();
    expect(asBiologicalSex(null)).toBeNull();
  });
});
