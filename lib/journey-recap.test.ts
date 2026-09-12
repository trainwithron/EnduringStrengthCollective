import { describe, it, expect } from "vitest";
import { formatJourneyDuration, formatWeightChange } from "./journey-recap";

describe("formatJourneyDuration", () => {
  it("shows days for a very new account", () => {
    expect(formatJourneyDuration(new Date("2026-09-10"), new Date("2026-09-12"))).toBe("2 days");
  });

  it("shows weeks once past 2 weeks but under 2 months", () => {
    expect(formatJourneyDuration(new Date("2026-08-01"), new Date("2026-09-12"))).toBe("6 weeks");
  });

  it("shows months once past 2 months but under a year", () => {
    expect(formatJourneyDuration(new Date("2026-03-12"), new Date("2026-09-12"))).toBe("6 months");
  });

  it("shows years once past a year", () => {
    expect(formatJourneyDuration(new Date("2024-09-12"), new Date("2026-09-12"))).toBe("2 years");
  });

  it("uses singular units correctly", () => {
    expect(formatJourneyDuration(new Date("2026-09-11"), new Date("2026-09-12"))).toBe("1 day");
  });
});

describe("formatWeightChange", () => {
  it("reports a loss without disclosing either absolute weight", () => {
    expect(formatWeightChange(-12)).toBe("down 12 lbs");
  });

  it("reports a gain", () => {
    expect(formatWeightChange(5)).toBe("up 5 lbs");
  });

  it("treats anything under 1 lb as holding steady", () => {
    expect(formatWeightChange(0.4)).toBe("holding steady");
    expect(formatWeightChange(-0.9)).toBe("holding steady");
  });
});
