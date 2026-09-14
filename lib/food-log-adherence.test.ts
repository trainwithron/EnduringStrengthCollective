import { describe, expect, it } from "vitest";
import { computeAdherenceDays } from "./food-log-adherence";

describe("computeAdherenceDays", () => {
  it("counts distinct logged days within the window", () => {
    expect(
      computeAdherenceDays(["2026-09-14", "2026-09-13", "2026-09-13", "2026-09-10"], "2026-09-14")
    ).toBe(3);
  });

  it("ignores entries outside the window", () => {
    expect(computeAdherenceDays(["2026-09-01"], "2026-09-14")).toBe(0);
  });

  it("returns 0 for no entries at all", () => {
    expect(computeAdherenceDays([], "2026-09-14")).toBe(0);
  });

  it("caps at the window size even with every day logged", () => {
    const allSevenDays = [
      "2026-09-14",
      "2026-09-13",
      "2026-09-12",
      "2026-09-11",
      "2026-09-10",
      "2026-09-09",
      "2026-09-08",
    ];
    expect(computeAdherenceDays(allSevenDays, "2026-09-14")).toBe(7);
  });

  it("includes today itself as part of the window", () => {
    expect(computeAdherenceDays(["2026-09-14"], "2026-09-14")).toBe(1);
  });
});
