import { describe, expect, it } from "vitest";
import { belowFloorMessage, calorieFloor, isBelowFloor } from "@/lib/calorie-floor";

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
