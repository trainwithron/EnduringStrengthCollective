import { describe, it, expect } from "vitest";
import { enumerateDateKeys } from "./date-range";

describe("enumerateDateKeys", () => {
  it("expands an inclusive range of a few days", () => {
    expect(enumerateDateKeys("2026-09-10", "2026-09-13")).toEqual([
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
      "2026-09-13",
    ]);
  });

  it("returns a single day when start equals end", () => {
    expect(enumerateDateKeys("2026-09-10", "2026-09-10")).toEqual(["2026-09-10"]);
  });

  it("returns an empty array when end is before start", () => {
    expect(enumerateDateKeys("2026-09-13", "2026-09-10")).toEqual([]);
  });

  it("crosses a month boundary correctly", () => {
    expect(enumerateDateKeys("2026-09-29", "2026-10-02")).toEqual([
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
    ]);
  });

  it("caps at maxDays rather than generating an unbounded range", () => {
    const result = enumerateDateKeys("2026-01-01", "2026-12-31", 5);
    expect(result).toHaveLength(5);
    expect(result[0]).toBe("2026-01-01");
  });

  it("returns an empty array for an invalid date string", () => {
    expect(enumerateDateKeys("not-a-date", "2026-09-13")).toEqual([]);
  });
});
