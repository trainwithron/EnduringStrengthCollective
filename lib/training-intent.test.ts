import { describe, it, expect } from "vitest";
import { detectTrainingIntent, REST_TEMPO_SUGGESTIONS, TRAINING_INTENTS } from "./training-intent";

describe("detectTrainingIntent", () => {
  it("matches Ron's own example: Powerlifting Advanced", () => {
    expect(detectTrainingIntent("Powerlifting Advanced")).toBe("Powerlifting/Strength");
  });

  it("matches hypertrophy-flavored names", () => {
    expect(detectTrainingIntent("12-Week Hypertrophy Block")).toBe("Hypertrophy");
  });

  it("matches a sport name", () => {
    expect(detectTrainingIntent("8-Week Football Off-Season")).toBe("Sport-Specific");
  });

  it("returns null for a name with no recognizable keyword", () => {
    expect(detectTrainingIntent("Karina's Program")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(detectTrainingIntent("POWERLIFTING PREP")).toBe("Powerlifting/Strength");
  });

  it("picks the earlier-declared intent on a genuine tie", () => {
    // Contains both "strength" (Powerlifting/Strength) and "youth" (Youth) —
    // Powerlifting/Strength is declared first in TRAINING_INTENTS.
    expect(detectTrainingIntent("Youth Strength Program")).toBe("Powerlifting/Strength");
  });
});

describe("REST_TEMPO_SUGGESTIONS", () => {
  it("only offers suggestions for intents with a real sourced number", () => {
    expect(REST_TEMPO_SUGGESTIONS["Powerlifting/Strength"]).toBeDefined();
    expect(REST_TEMPO_SUGGESTIONS["Hypertrophy"]).toBeDefined();
    expect(REST_TEMPO_SUGGESTIONS["Power/Explosive"]).toBeDefined();
  });

  it("deliberately withholds Youth — needs CSCS review before auto-filling", () => {
    expect(REST_TEMPO_SUGGESTIONS["Youth"]).toBeUndefined();
  });

  it("deliberately withholds General Fitness, Sport-Specific, and Mobility/Flow — no single defensible number", () => {
    expect(REST_TEMPO_SUGGESTIONS["General Fitness"]).toBeUndefined();
    expect(REST_TEMPO_SUGGESTIONS["Sport-Specific"]).toBeUndefined();
    expect(REST_TEMPO_SUGGESTIONS["Mobility/Flow"]).toBeUndefined();
  });

  it("every suggestion has a positive rest duration and a named source", () => {
    for (const suggestions of Object.values(REST_TEMPO_SUGGESTIONS)) {
      for (const s of suggestions ?? []) {
        expect(s.restSeconds).toBeGreaterThan(0);
        expect(s.source.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("TRAINING_INTENTS", () => {
  it("has no duplicate entries", () => {
    expect(new Set(TRAINING_INTENTS).size).toBe(TRAINING_INTENTS.length);
  });
});
