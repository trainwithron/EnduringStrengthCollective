import { describe, expect, it } from "vitest";
import { aboutYouComplete, missingForBaseline, readDateOfBirth, rowToBodyProfile } from "@/lib/client-body-profile";

describe("the one date-of-birth reader", () => {
  it("prefers the intake's date, then the profile's birthday, else none", () => {
    expect(readDateOfBirth({ intakeDateOfBirth: "2000-01-02", birthday: "1999-05-05" })).toBe("2000-01-02");
    expect(readDateOfBirth({ intakeDateOfBirth: null, birthday: "1999-05-05" })).toBe("1999-05-05");
    expect(readDateOfBirth({ intakeDateOfBirth: null, birthday: null })).toBeNull();
  });
  it("reads both from their rows and ignores junk", () => {
    const p = rowToBodyProfile(
      { birthday: "1999-05-05T00:00:00Z", height_cm: "178", biological_sex: "male", activity_level: "light", weight_unit: "kg", portion_units: "household", body_fat_pct: null },
      { date_of_birth: "not a date" }
    );
    expect(p.birthday).toBe("1999-05-05");
    expect(p.intakeDateOfBirth).toBeNull();
    expect(p.heightCm).toBe(178);
    expect(p.sex).toBe("male");
    expect(p.activity).toBe("light");
    expect(p.weightUnit).toBe("kg");
    expect(p.portionUnits).toBe("household");
    expect(p.bodyFatPct).toBeNull();
  });
  it("defaults: pounds, grams, nothing known", () => {
    const p = rowToBodyProfile(null, null);
    expect(p.weightUnit).toBe("lb");
    expect(p.portionUnits).toBe("grams");
    expect(p.sex).toBeNull();
    expect(p.activity).toBeNull();
    expect(readDateOfBirth(p)).toBeNull();
  });
  it("an unknown activity or sex is read as not given", () => {
    const p = rowToBodyProfile({ activity_level: "extreme", biological_sex: "x" }, null);
    expect(p.activity).toBeNull();
    expect(p.sex).toBeNull();
  });
});

describe("what a starting target still needs", () => {
  it("names each missing piece; sex is never required", () => {
    const empty = rowToBodyProfile(null, null);
    expect(missingForBaseline(empty, null)).toEqual(["height", "a weight", "date of birth", "activity level"]);
    const full = rowToBodyProfile({ height_cm: 170, activity_level: "moderate", birthday: "1990-01-01" }, null);
    expect(missingForBaseline(full, 150)).toEqual([]);
    expect(aboutYouComplete(full, 150)).toBe(true);
    expect(aboutYouComplete(full, null)).toBe(false);
  });
});
