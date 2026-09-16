import { describe, it, expect } from "vitest";
import { taperAdjustedMacroSuggestion, volumeRelativeMacroSuggestion } from "./nutrition-block-adjustment";
import type { EventWindow } from "./event-window";
import { DEFAULT_ADJUSTMENT_PCT } from "./nutrition-checkin";

function eventWindow(overrides: Partial<EventWindow>): EventWindow {
  return {
    targetDate: "2026-10-01",
    sportType: "marathon",
    expectedDurationMinutes: 240,
    priority: "A",
    weightClassFlag: false,
    ...overrides,
  };
}

describe("taperAdjustedMacroSuggestion", () => {
  it("returns null outside the taper window", () => {
    const result = taperAdjustedMacroSuggestion({
      baseCalories: 2400,
      eventWindow: eventWindow({ targetDate: "2026-12-01" }),
      today: new Date("2026-10-01T00:00:00"),
      taperWeeks: 2,
      bodyWeightKg: 80,
    });
    expect(result).toBeNull();
  });

  it("freezes calories inside the taper window — hands the baseline back unchanged, never lower", () => {
    const result = taperAdjustedMacroSuggestion({
      baseCalories: 2400,
      eventWindow: eventWindow({ targetDate: "2026-10-10" }),
      today: new Date("2026-10-01T00:00:00"),
      taperWeeks: 2,
      bodyWeightKg: 80,
    });
    expect(result?.kind).toBe("taper");
    expect(result?.suggestedCalories).toBe(2400);
    expect(result?.suggestedCarbsG).toBeNull();
  });

  it("bumps carbs to the 10-12 g/kg midpoint in the final 2 days of an event over 90 minutes", () => {
    const result = taperAdjustedMacroSuggestion({
      baseCalories: 2400,
      eventWindow: eventWindow({ targetDate: "2026-10-03", expectedDurationMinutes: 240 }),
      today: new Date("2026-10-01T00:00:00"),
      taperWeeks: 2,
      bodyWeightKg: 80,
    });
    expect(result?.suggestedCarbsG).toBe(880); // 80kg x 11 g/kg
    expect(result?.suggestedCalories).toBe(2400);
    expect(result?.headline).toContain("bump carbs");
  });

  it("does not carb-load for a short event even inside the final 2 days", () => {
    const result = taperAdjustedMacroSuggestion({
      baseCalories: 2400,
      eventWindow: eventWindow({ targetDate: "2026-10-02", expectedDurationMinutes: 60 }),
      today: new Date("2026-10-01T00:00:00"),
      taperWeeks: 2,
      bodyWeightKg: 80,
    });
    expect(result?.kind).toBe("taper");
    expect(result?.suggestedCarbsG).toBeNull();
  });

  it("does not carb-load 3+ days out even for a long event", () => {
    const result = taperAdjustedMacroSuggestion({
      baseCalories: 2400,
      eventWindow: eventWindow({ targetDate: "2026-10-05", expectedDurationMinutes: 240 }),
      today: new Date("2026-10-01T00:00:00"),
      taperWeeks: 2,
      bodyWeightKg: 80,
    });
    expect(result?.suggestedCarbsG).toBeNull();
  });

  it("still fires the freeze, with no carb number, when no body weight is on file", () => {
    const result = taperAdjustedMacroSuggestion({
      baseCalories: 2400,
      eventWindow: eventWindow({ targetDate: "2026-10-02", expectedDurationMinutes: 240 }),
      today: new Date("2026-10-01T00:00:00"),
      taperWeeks: 2,
      bodyWeightKg: null,
    });
    expect(result?.suggestedCalories).toBe(2400);
    expect(result?.suggestedCarbsG).toBeNull();
    expect(result?.rationale).toContain("log a body weight");
  });

  it("returns null once the event has passed", () => {
    const result = taperAdjustedMacroSuggestion({
      baseCalories: 2400,
      eventWindow: eventWindow({ targetDate: "2026-09-01" }),
      today: new Date("2026-10-01T00:00:00"),
      taperWeeks: 2,
      bodyWeightKg: 80,
    });
    expect(result).toBeNull();
  });
});

describe("volumeRelativeMacroSuggestion", () => {
  it("stays quiet when this week is within 30% of the trailing average", () => {
    expect(
      volumeRelativeMacroSuggestion({ baseCalories: 2400, thisWeekVolume: 8000, trailingAvgVolume: 10000 })
    ).toBeNull();
  });

  it("suggests lowering calories by the app's default adjustment on a clearly lighter week", () => {
    const result = volumeRelativeMacroSuggestion({
      baseCalories: 2400,
      thisWeekVolume: 5000,
      trailingAvgVolume: 10000,
    });
    expect(result?.kind).toBe("volume");
    expect(result?.suggestedCalories).toBe(Math.round(2400 * (1 - DEFAULT_ADJUSTMENT_PCT / 100)));
    expect(result?.headline).toContain("below");
  });

  it("suggests raising calories by the app's default adjustment on a clearly heavier week", () => {
    const result = volumeRelativeMacroSuggestion({
      baseCalories: 2400,
      thisWeekVolume: 15000,
      trailingAvgVolume: 10000,
    });
    expect(result?.suggestedCalories).toBe(Math.round(2400 * (1 + DEFAULT_ADJUSTMENT_PCT / 100)));
    expect(result?.headline).toContain("above");
  });

  it("fires exactly at the 30% boundary", () => {
    expect(
      volumeRelativeMacroSuggestion({ baseCalories: 2400, thisWeekVolume: 7000, trailingAvgVolume: 10000 })
    ).not.toBeNull();
  });

  it("returns null with no baseline calories to adjust from", () => {
    expect(
      volumeRelativeMacroSuggestion({ baseCalories: null, thisWeekVolume: 5000, trailingAvgVolume: 10000 })
    ).toBeNull();
  });

  it("returns null with no trailing history to compare against", () => {
    expect(
      volumeRelativeMacroSuggestion({ baseCalories: 2400, thisWeekVolume: 5000, trailingAvgVolume: 0 })
    ).toBeNull();
  });

  it("never proposes a carb change — that's the taper rule's job only", () => {
    const result = volumeRelativeMacroSuggestion({
      baseCalories: 2400,
      thisWeekVolume: 5000,
      trailingAvgVolume: 10000,
    });
    expect(result?.suggestedCarbsG).toBeNull();
  });
});
