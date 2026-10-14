import { describe, it, expect } from "vitest";
import { buildOverlay, dayNumber, niceScale, rangeStartDay, readoutAt, type Frame } from "@/lib/overlay-math";

const frame: Frame = { width: 600, height: 240, left: 50, right: 50, top: 10, bottom: 30 };
const today = "2026-10-14";

describe("axes", () => {
  it("round numbers that cover the data", () => {
    const s = niceScale(172.4, 189.1);
    expect(s.min).toBeLessThanOrEqual(172.4);
    expect(s.max).toBeGreaterThanOrEqual(189.1);
    expect(s.ticks.length).toBeGreaterThanOrEqual(3);
    expect(s.ticks.length).toBeLessThanOrEqual(8);
    expect(niceScale(1800, 2600).ticks).toEqual([1800, 2000, 2200, 2400, 2600]);
  });
  it("a flat series still has a drawable axis, and bad numbers do not crash it", () => {
    const flat = niceScale(180, 180);
    expect(flat.max).toBeGreaterThan(flat.min);
    expect(niceScale(Number.NaN, 5).ticks.length).toBe(2);
  });
});

describe("ranges", () => {
  it("3, 6 and 12 months back from today, never before the first data, All starts at the first data", () => {
    expect(dayNumber(today) - rangeStartDay("3M", today, "2020-01-01")).toBe(91);
    expect(dayNumber(today) - rangeStartDay("6M", today, "2020-01-01")).toBe(182);
    expect(dayNumber(today) - rangeStartDay("1Y", today, "2020-01-01")).toBe(365);
    expect(rangeStartDay("1Y", today, "2026-09-01")).toBe(dayNumber("2026-09-01"));
    expect(rangeStartDay("All", today, "2024-03-05")).toBe(dayNumber("2024-03-05"));
  });
});

describe("one picture of three series", () => {
  const input = {
    weight: [
      { date: "2026-08-01", value: 190 },
      { date: "2026-09-01", value: 185 },
      { date: "2026-10-01", value: 181 },
    ],
    target: [
      { date: "2026-08-01", value: 2400 },
      { date: "2026-09-01", value: 2200 },
      { date: "2026-10-01", value: 2200 },
    ],
    intake: [{ date: "2026-09-02", value: 2350 }],
  };
  const model = buildOverlay(input, "All", today, frame);

  it("shares one time axis: the same date lands at the same x in every series", () => {
    expect(model.xOf(dayNumber("2026-08-01"))).toBeCloseTo(frame.left, 5);
    expect(model.xOf(dayNumber(today))).toBeCloseTo(frame.width - frame.right, 5);
    expect(model.weightDots[1].x).toBeCloseTo(model.xOf(dayNumber("2026-09-01")), 5);
    expect(model.dayAt(model.xOf(dayNumber("2026-09-15")))).toBe(dayNumber("2026-09-15"));
  });
  it("two scales: pounds from the weights, calories from the target and the intake together", () => {
    expect(model.weightScale!.min).toBeLessThanOrEqual(181);
    expect(model.weightScale!.max).toBeGreaterThanOrEqual(190);
    expect(model.calorieScale!.min).toBeLessThanOrEqual(2200);
    expect(model.calorieScale!.max).toBeGreaterThanOrEqual(2400);
    // higher values sit higher on the page (smaller y), and everything is inside the plot
    expect(model.weightY(190)).toBeLessThan(model.weightY(181));
    expect(model.calorieY(2400)).toBeLessThan(model.calorieY(2200));
    for (const y of [model.weightY(181), model.weightY(190), model.calorieY(2200), model.calorieY(2400)]) {
      expect(y).toBeGreaterThanOrEqual(frame.top - 0.001);
      expect(y).toBeLessThanOrEqual(frame.height - frame.bottom + 0.001);
    }
  });
  it("five date labels along the bottom, first at the left edge and last at the right", () => {
    expect(model.xTicks).toHaveLength(5);
    expect(model.xTicks[0].x).toBeCloseTo(frame.left, 5);
    expect(model.xTicks[4].x).toBeCloseTo(frame.width - frame.right, 5);
    expect(model.xTicks[0].label).toBe("Aug 1");
  });
  it("a shorter range keeps only what falls inside it", () => {
    const short = buildOverlay(input, "3M", "2026-12-30", frame);
    expect(short.series.weight.map((p) => p.date)).toEqual(["2026-10-01"]);
    expect(buildOverlay(input, "3M", today, frame).series.weight).toHaveLength(3);
    expect(buildOverlay(input, "3M", "2027-06-01", frame).hasData).toBe(false);
  });
  it("no data at all: nothing to draw and no scales", () => {
    const empty = buildOverlay({ weight: [], target: [], intake: [] }, "All", today, frame);
    expect(empty.hasData).toBe(false);
    expect(empty.weightScale).toBeNull();
    expect(empty.calorieScale).toBeNull();
    expect(empty.paths).toEqual({ weight: "", target: "", intake: "" });
  });
  it("the pointer readout: weight and intake only for days they were logged, the target as the standing number", () => {
    expect(readoutAt(model.series, dayNumber("2026-09-01"))).toEqual({ date: "2026-09-01", weight: 185, target: 2200, intake: null });
    expect(readoutAt(model.series, dayNumber("2026-09-02"))).toEqual({ date: "2026-09-02", weight: 185, target: 2200, intake: 2350 });
    expect(readoutAt(model.series, dayNumber("2026-09-20"))).toEqual({ date: "2026-09-20", weight: null, target: 2200, intake: null });
    expect(readoutAt(model.series, dayNumber("2026-07-15")).target).toBeNull();
  });
});
