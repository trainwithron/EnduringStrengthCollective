import { describe, it, expect } from "vitest";
import { addDaysKey, dateKeyInZone, defaultChoice, inPeriod, lifetimeStats, monthLabel, monthOptions, mondayOf, periodStats, yearOptions } from "@/lib/progress-periods";

const events = [
  { date: "2026-10-12", volume: 1000 }, // Monday
  { date: "2026-10-14", volume: 2000 }, // Wednesday (today)
  { date: "2026-10-11", volume: 500 }, // the Sunday before
  { date: "2026-09-30", volume: 700 },
  { date: "2025-12-31", volume: 300 },
];
const prDates = ["2026-10-14", "2026-10-11", "2025-12-31"];
const today = "2026-10-14";

describe("calendar weeks", () => {
  it("a week runs Monday to Sunday", () => {
    expect(mondayOf("2026-10-14")).toBe("2026-10-12");
    expect(mondayOf("2026-10-12")).toBe("2026-10-12");
    expect(mondayOf("2026-10-18")).toBe("2026-10-12"); // Sunday belongs to the week that began on Monday
    expect(mondayOf("2026-10-11")).toBe("2026-10-05");
    expect(addDaysKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysKey("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("weekly is this calendar week only", () => {
    const weekly = defaultChoice(today);
    expect(inPeriod("2026-10-12", weekly, today)).toBe(true);
    expect(inPeriod("2026-10-18", weekly, today)).toBe(true);
    expect(inPeriod("2026-10-11", weekly, today)).toBe(false);
    expect(inPeriod("2026-10-19", weekly, today)).toBe(false);
    expect(periodStats(events, prDates, weekly, today)).toEqual({ workouts: 2, volume: 3000, prs: 1 });
  });
});

describe("months and years", () => {
  it("monthly is the picked month, yearly the picked year", () => {
    const month = { ...defaultChoice(today), kind: "monthly" as const, month: "2026-09" };
    expect(periodStats(events, prDates, month, today)).toEqual({ workouts: 1, volume: 700, prs: 0 });
    const oct = { ...month, month: "2026-10" };
    expect(periodStats(events, prDates, oct, today)).toEqual({ workouts: 3, volume: 3500, prs: 2 });
    const year = { ...defaultChoice(today), kind: "yearly" as const, year: "2025" };
    expect(periodStats(events, prDates, year, today)).toEqual({ workouts: 1, volume: 300, prs: 1 });
  });
  it("the month list runs from the first day with data to this month, newest first, with names", () => {
    const options = monthOptions(["2026-07-20", "2026-10-02"], today);
    expect(options.map((o) => o.key)).toEqual(["2026-10", "2026-09", "2026-08", "2026-07"]);
    expect(options[1].label).toBe("September 2026");
    expect(monthOptions(["2025-11-05"], "2026-02-10").map((o) => o.key)).toEqual(["2026-02", "2026-01", "2025-12", "2025-11"]);
    expect(monthOptions([], today).map((o) => o.key)).toEqual(["2026-10"]);
    expect(monthLabel("2026-01")).toBe("January 2026");
  });
  it("the year list runs from the first year with data to this year, newest first", () => {
    expect(yearOptions(["2024-05-01", "2026-01-01"], today)).toEqual(["2026", "2025", "2024"]);
    expect(yearOptions([], today)).toEqual(["2026"]);
  });
});

describe("lifetime and zones", () => {
  it("lifetime counts every workout, all the volume, every record", () => {
    expect(lifetimeStats(events, prDates)).toEqual({ workouts: 5, volume: 4500, prs: 3 });
    expect(lifetimeStats([], [])).toEqual({ workouts: 0, volume: 0, prs: 0 });
  });
  it("a timestamp becomes the date in the coach's own zone (a late evening in Los Angeles is the next day in UTC)", () => {
    expect(dateKeyInZone("2026-10-14T03:30:00Z", "America/Los_Angeles")).toBe("2026-10-13");
    expect(dateKeyInZone("2026-10-14T03:30:00Z", "UTC")).toBe("2026-10-14");
  });
});
