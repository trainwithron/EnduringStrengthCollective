import { describe, it, expect } from "vitest";
import { matchExercise, matchTopN, normalizeName, confidenceBucket } from "./exercise-matching";

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

describe("matchTopN", () => {
  const library = [
    { name: "Back Squat" },
    { name: "Front Squat" },
    { name: "Goblet Squat" },
    { name: "Bench Press" },
  ];

  it("returns nothing for empty input", () => {
    expect(matchTopN("", library, [])).toEqual([]);
  });

  it("ranks multiple plausible candidates instead of collapsing to one", () => {
    const results = matchTopN("squat", library, []);
    expect(results.length).toBeGreaterThan(1);
    expect(results.every((r) => r.exerciseName.toLowerCase().includes("squat"))).toBe(true);
  });

  it("puts a learned alias first, even above an exact library match", () => {
    const results = matchTopN(
      "BB Back Squat V2",
      library,
      [{ rawName: "BB Back Squat V2", exerciseName: "Back Squat" }]
    );
    expect(results[0]).toEqual({ exerciseName: "Back Squat", score: 1, isAlias: true });
  });

  it("respects the n cap", () => {
    const results = matchTopN("squat", library, [], 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("never returns the same exercise twice", () => {
    const results = matchTopN("squat", library, []);
    const names = results.map((r) => r.exerciseName);
    expect(new Set(names).size).toBe(names.length);
  });

  it("excludes completely unrelated exercises rather than padding the list", () => {
    const results = matchTopN("bench press", library, []);
    expect(results.some((r) => r.exerciseName === "Back Squat")).toBe(false);
  });

  it("does not hard-merge ipsilateral/alternating as synonyms — ranks both real candidates instead", () => {
    // Real distinction from the research: ipsilateral/contralateral describes
    // load placement, "alternating" describes rep sequencing — not synonyms.
    const splitStanceLibrary = [
      { name: "Alternating Dumbbell Lunge" },
      { name: "Ipsilateral Loaded Split Squat" },
    ];
    const results = matchTopN("alternating lunge", splitStanceLibrary, []);
    expect(results[0].exerciseName).toBe("Alternating Dumbbell Lunge");
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
