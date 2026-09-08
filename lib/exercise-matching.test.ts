import { describe, it, expect } from "vitest";
import { matchExercise, normalizeName, confidenceBucket } from "./exercise-matching";

describe("normalizeName", () => {
  it("is order-invariant across word order and punctuation", () => {
    expect(normalizeName("Barbell Back Squat")).toBe(normalizeName("Back Squat, Barbell"));
  });

  it("expands the bulgarian split squat synonym to match the RFESS naming", () => {
    expect(normalizeName("Bulgarian Split Squat")).toBe(
      normalizeName("Rear-Foot Elevated Split Squat")
    );
  });

  it("expands common abbreviations", () => {
    expect(normalizeName("Incline DB Press")).toBe(normalizeName("Incline Dumbbell Press"));
  });
});

describe("matchExercise", () => {
  const library = [{ name: "Back Squats, Barbell" }, { name: "Incline Dumbbell Press" }];

  it("finds an exact match after normalization", () => {
    const result = matchExercise("Barbell Back Squats", library, []);
    expect(result.confidence).toBe("exact");
    expect(result.exerciseName).toBe("Back Squats, Barbell");
  });

  it("finds a synonym match via the phrase dictionary", () => {
    const result = matchExercise("Bulgarian Split Squat", [{ name: "Rear-Foot Elevated Split Squat" }], []);
    expect(result.confidence).toBe("exact");
    expect(result.exerciseName).toBe("Rear-Foot Elevated Split Squat");
  });

  it("prefers a learned alias over a fuzzy library match", () => {
    const result = matchExercise(
      "BB Back Squat V2",
      library,
      [{ rawName: "BB Back Squat V2", exerciseName: "Back Squats, Barbell" }]
    );
    expect(result.confidence).toBe("alias");
    expect(result.exerciseName).toBe("Back Squats, Barbell");
  });

  it("falls back to a fuzzy match above the threshold", () => {
    const result = matchExercise("Dumbbell Incline Bench Press", library, []);
    expect(result.confidence).toBe("fuzzy");
    expect(result.exerciseName).toBe("Incline Dumbbell Press");
  });

  it("returns none when nothing is close enough", () => {
    const result = matchExercise("Nordic Hamstring Curl", library, []);
    expect(result.confidence).toBe("none");
    expect(result.exerciseName).toBeNull();
  });

  it("does not confuse two different presses that only share an equipment word", () => {
    // Real regression: "Barbell Bench Press" vs "Barbell Overhead Press"
    // share "barbell" and "press" (2 of 4 tokens each) — a 0.5 threshold
    // treated these as the same exercise, which is wrong; they're
    // different movements entirely.
    const result = matchExercise(
      "Barbell Bench Press",
      [{ name: "Barbell Overhead Press" }],
      []
    );
    expect(result.confidence).toBe("none");
    expect(result.exerciseName).toBeNull();
  });
});

describe("confidenceBucket", () => {
  it("maps confidence levels to colors", () => {
    expect(confidenceBucket("exact")).toBe("green");
    expect(confidenceBucket("alias")).toBe("green");
    expect(confidenceBucket("fuzzy")).toBe("yellow");
    expect(confidenceBucket("none")).toBe("red");
  });
});
