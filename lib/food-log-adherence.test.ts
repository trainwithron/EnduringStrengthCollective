import { describe, expect, it } from "vitest";
import { ADHERENCE_WINDOW_DAYS, computeAdherenceDays, lastDayKeys, loggedDateKeys, summarizeAdherence } from "./food-log-adherence";

describe("computeAdherenceDays", () => {
  it("counts distinct logged days inside the 7-day window", () => {
    expect(computeAdherenceDays(["2026-09-14", "2026-09-13", "2026-09-13", "2026-09-10"], "2026-09-14")).toBe(3);
  });
  it("ignores days outside the window or in the future", () => {
    expect(computeAdherenceDays(["2026-09-01", "2026-09-15"], "2026-09-14")).toBe(0);
    expect(computeAdherenceDays([], "2026-09-14")).toBe(0);
  });
  it("counts all seven", () => {
    expect(computeAdherenceDays(lastDayKeys("2026-09-14"), "2026-09-14")).toBe(7);
    expect(computeAdherenceDays(["2026-09-14"], "2026-09-14")).toBe(1);
  });
  it("the window edge: today and the six days before it, not the seventh", () => {
    expect(computeAdherenceDays(["2026-09-08"], "2026-09-14")).toBe(1);
    expect(computeAdherenceDays(["2026-09-07"], "2026-09-14")).toBe(0);
  });
});

describe("the window is plain date keys, the same on every machine", () => {
  it("crosses a month, a year and a daylight-saving change without moving a day", () => {
    expect(lastDayKeys("2026-03-02")).toEqual(["2026-03-02", "2026-03-01", "2026-02-28", "2026-02-27", "2026-02-26", "2026-02-25", "2026-02-24"]);
    expect(lastDayKeys("2027-01-03")).toEqual(["2027-01-03", "2027-01-02", "2027-01-01", "2026-12-31", "2026-12-30", "2026-12-29", "2026-12-28"]);
    expect(lastDayKeys("2026-11-02")).toEqual(["2026-11-02", "2026-11-01", "2026-10-31", "2026-10-30", "2026-10-29", "2026-10-28", "2026-10-27"]);
    expect(lastDayKeys("2026-03-09")).toContain("2026-03-08");
    expect(lastDayKeys("2026-09-14")).toHaveLength(ADHERENCE_WINDOW_DAYS);
  });
});

describe("what counts as a logged day", () => {
  const entries = [
    { log_date: "2026-10-07", status: "logged" },
    { log_date: "2026-10-06", status: "skipped" },
    { log_date: "2026-10-05", status: null },
    { log_date: "2026-10-05", status: "logged" },
  ];
  it("a skip does not count", () => {
    expect(loggedDateKeys(entries)).toEqual(["2026-10-07", "2026-10-05", "2026-10-05"]);
  });
  it("5 of 7 is enough, 4 holds calories steady and says so", () => {
    const five = ["2026-10-07", "2026-10-06", "2026-10-05", "2026-10-04", "2026-10-03"].map((d) => ({ log_date: d, status: "logged" }));
    expect(summarizeAdherence(five, "2026-10-07", "Sam").heldForLowLogging).toBe(false);
    const s = summarizeAdherence(five.slice(0, 4), "2026-10-07", "Sam");
    expect(s.daysLogged).toBe(4);
    expect(s.heldForLowLogging).toBe(true);
    expect(s.line).toBe("Sam logged food on 4 of 7 days, so calories are held steady until there is enough to go on.");
  });
  it("no logs at all is zero days and held", () => {
    const s = summarizeAdherence([], "2026-10-07");
    expect(s.daysLogged).toBe(0);
    expect(s.heldForLowLogging).toBe(true);
  });
});
