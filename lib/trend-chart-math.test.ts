import { describe, it, expect } from "vitest";
import { computeChartGeometry } from "./trend-chart-math";

describe("computeChartGeometry", () => {
  it("returns null with fewer than 2 points", () => {
    expect(computeChartGeometry([], 300, 100, 10)).toBeNull();
    expect(computeChartGeometry([{ date: "2026-01-01", value: 180 }], 300, 100, 10)).toBeNull();
  });

  it("plots the first and last point at the horizontal extremes", () => {
    const geo = computeChartGeometry(
      [
        { date: "2026-01-01", value: 180 },
        { date: "2026-01-15", value: 175 },
        { date: "2026-02-01", value: 170 },
      ],
      300,
      100,
      10
    );
    expect(geo).not.toBeNull();
    expect(geo!.points[0].x).toBeCloseTo(10, 5);
    expect(geo!.points[2].x).toBeCloseTo(290, 5);
  });

  it("places the max value at the top and min value at the bottom", () => {
    const geo = computeChartGeometry(
      [
        { date: "2026-01-01", value: 100 },
        { date: "2026-01-02", value: 200 },
      ],
      300,
      100,
      0
    );
    // Higher value -> smaller y (SVG y grows downward).
    expect(geo!.points[1].y).toBeLessThan(geo!.points[0].y);
  });

  it("sorts out-of-order input by date before plotting", () => {
    const geo = computeChartGeometry(
      [
        { date: "2026-02-01", value: 999 },
        { date: "2026-01-01", value: 1 },
      ],
      300,
      100,
      0
    );
    expect(geo!.points[0].value).toBe(1);
    expect(geo!.points[1].value).toBe(999);
  });

  it("draws a flat trend line across the middle for a perfectly constant series", () => {
    const geo = computeChartGeometry(
      [
        { date: "2026-01-01", value: 50 },
        { date: "2026-01-02", value: 50 },
        { date: "2026-01-03", value: 50 },
      ],
      300,
      100,
      0
    );
    expect(geo!.trendLine.y1).toBeCloseTo(geo!.trendLine.y2, 5);
  });

  it("slopes the trend line downward (in y) for a rising series", () => {
    const geo = computeChartGeometry(
      [
        { date: "2026-01-01", value: 100 },
        { date: "2026-01-02", value: 150 },
        { date: "2026-01-03", value: 200 },
      ],
      300,
      100,
      0
    );
    // Rising values -> trend end y is smaller (higher on screen) than start.
    expect(geo!.trendLine.y2).toBeLessThan(geo!.trendLine.y1);
  });

  it("reports the real min/max values", () => {
    const geo = computeChartGeometry(
      [
        { date: "2026-01-01", value: 12 },
        { date: "2026-01-02", value: 40 },
        { date: "2026-01-03", value: 7 },
      ],
      300,
      100,
      0
    );
    expect(geo!.minValue).toBe(7);
    expect(geo!.maxValue).toBe(40);
  });
});
