import { describe, expect, it } from "vitest";
import { NO_TARGET_LINE, dailyCaloriesFromLog, hasTarget, noTargetLine, sumLoggedFood } from "@/lib/nutrition-tracking";

describe("sumLoggedFood", () => {
  it("adds calories and macros of what was eaten", () => {
    expect(
      sumLoggedFood([
        { status: "ate_it", calories: 500, proteinG: 40, carbsG: 50, fatG: 12 },
        { status: "quick_log", calories: 250, proteinG: 10, carbsG: 30, fatG: 8 },
      ])
    ).toEqual({ calories: 750, proteinG: 50, carbsG: 80, fatG: 20 });
  });
  it("ignores skipped meals and treats missing numbers as zero", () => {
    expect(sumLoggedFood([{ status: "skipped", calories: 900 }, { status: "modified", calories: 300 }])).toEqual({ calories: 300, proteinG: 0, carbsG: 0, fatG: 0 });
  });
  it("is all zeros for an empty log, so a client with no target and nothing logged still sees totals", () => {
    expect(sumLoggedFood([])).toEqual({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0 });
  });
});

describe("dailyCaloriesFromLog", () => {
  it("sums per day, oldest first, leaving days with nothing logged as gaps", () => {
    const out = dailyCaloriesFromLog([
      { log_date: "2026-10-03", status: "quick_log", calories: 600 },
      { log_date: "2026-10-01", status: "ate_it", calories: 700 },
      { log_date: "2026-10-01", status: "quick_log", calories: 150.4 },
      { log_date: "2026-10-02", status: "skipped", calories: 800 },
    ]);
    expect(out).toEqual([
      { date: "2026-10-01", value: 850 },
      { date: "2026-10-03", value: 600 },
    ]);
  });
});

describe("hasTarget", () => {
  it("is true with a calorie or protein number and false otherwise", () => {
    expect(hasTarget({ calories: 2200 })).toBe(true);
    expect(hasTarget({ proteinG: 150 })).toBe(true);
    expect(hasTarget({ calories: null, proteinG: null, carbsG: 200 })).toBe(false);
    expect(hasTarget(null)).toBe(false);
  });
});

describe("noTargetLine", () => {
  it("promises a target only to clients on a tier that has them", () => {
    expect(noTargetLine(true)).toBe(NO_TARGET_LINE);
    expect(noTargetLine(false)).toBe("Track what you eat. Targets are not part of your plan.");
  });
});

describe("the no-target line", () => {
  it("is the friendly wording Ron asked for", () => {
    expect(NO_TARGET_LINE).toBe("Your coach hasn't set a target yet. You can still track what you eat.");
  });
});
