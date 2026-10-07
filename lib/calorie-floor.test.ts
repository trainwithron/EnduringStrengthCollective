import { describe, expect, it } from "vitest";
import { belowFloorMessage, calorieFloor, floorBasisNote, isBelowFloor } from "@/lib/calorie-floor";

describe("the soft calorie floor", () => {
  it("is 1200 for a woman and for someone whose sex is not on file, 1500 for a man, when there is no BMR", () => {
    expect(calorieFloor({ sex: "female", bmr: null })).toBe(1200);
    expect(calorieFloor({ sex: null, bmr: null })).toBe(1200);
    expect(calorieFloor({ sex: "male", bmr: null })).toBe(1500);
  });
  it("is the client's own BMR when that is higher", () => {
    expect(calorieFloor({ sex: "female", bmr: 1480.4 })).toBe(1480);
    expect(calorieFloor({ sex: "male", bmr: 1900 })).toBe(1900);
  });
  it("keeps the base when the BMR is lower, zero, or not a number", () => {
    expect(calorieFloor({ sex: "female", bmr: 1100 })).toBe(1200);
    expect(calorieFloor({ sex: "male", bmr: 1400 })).toBe(1500);
    expect(calorieFloor({ sex: "male", bmr: 0 })).toBe(1500);
    expect(calorieFloor({ sex: "male", bmr: Number.NaN })).toBe(1500);
  });
  it("a target is below the floor only when strictly under it (the floor itself is fine); blank is never a warning", () => {
    expect(isBelowFloor(1499, 1500)).toBe(true);
    expect(isBelowFloor(1500, 1500)).toBe(false);
    expect(isBelowFloor(2400, 1500)).toBe(false);
    expect(isBelowFloor(null, 1500)).toBe(false);
    expect(isBelowFloor(0, 1500)).toBe(false);
  });
  it("the warning names the client and the floor and says it can still be applied", () => {
    expect(belowFloorMessage(1350, 1500, "Sam")).toBe("1,350 is under Sam's estimated floor of 1,500. Calories this low are rarely a good idea. You can still apply it.");
    expect(belowFloorMessage(1350, 1500, "this client")).toContain("this client's estimated floor");
  });
});

describe("what the floor rests on", () => {
  it("names the missing inputs when it falls back to the base floor", () => {
    expect(floorBasisNote({ bmr: null, weightAgeDays: null, missing: ["height", "sex"], floor: 1200 })).toBe("This is the base floor of 1,200: add height, sex for a precise one.");
    expect(floorBasisNote({ bmr: null, weightAgeDays: null, missing: [], floor: 1500 })).toContain("height, sex and date of birth");
  });
  it("says so when the weight is old, and stays quiet when it is recent", () => {
    expect(floorBasisNote({ bmr: 1700, weightAgeDays: 45, missing: [], floor: 1700 })).toBe("Based on a weight from 45 days ago.");
    expect(floorBasisNote({ bmr: 1700, weightAgeDays: 30, missing: [], floor: 1700 })).toBeNull();
    expect(floorBasisNote({ bmr: 1700, weightAgeDays: 3, missing: [], floor: 1700 })).toBeNull();
    expect(floorBasisNote({ bmr: 1700, weightAgeDays: null, missing: [], floor: 1700 })).toBeNull();
  });
});
