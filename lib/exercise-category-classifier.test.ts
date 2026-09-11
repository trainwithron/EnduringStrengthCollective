import { describe, expect, it } from "vitest";
import { classifyExerciseCategory } from "./exercise-category-classifier";

describe("classifyExerciseCategory", () => {
  it("matches plain, common exercise names", () => {
    expect(classifyExerciseCategory("Barbell Back Squat")).toBe("Legs");
    expect(classifyExerciseCategory("Pull-Up")).toBe("Pull");
    expect(classifyExerciseCategory("Bench Press")).toBe("Push");
    expect(classifyExerciseCategory("Plank")).toBe("Core");
    expect(classifyExerciseCategory("Treadmill Sprint")).toBe("Cardio");
    expect(classifyExerciseCategory("Hip Flexor Stretch")).toBe("Mobility");
    expect(classifyExerciseCategory("Turkish Get-Up")).toBe("Full Body");
  });

  it("resolves off the core movement word regardless of modifiers surrounding it", () => {
    // The real repro case this feature is built around.
    expect(classifyExerciseCategory("Ipsilateral Split Stance Overhead Lunge with Kettlebell")).toBe(
      "Legs"
    );
    expect(classifyExerciseCategory("Tempo 3-1-1 Barbell Back Squat")).toBe("Legs");
    expect(classifyExerciseCategory("Single-Arm Dumbbell Bent-Over Row")).toBe("Pull");
  });

  it("prefers a specific multi-word phrase over a generic single word it contains", () => {
    // "Leg Press"/"Leg Curl"/"Leg Extension" must not fall to the
    // generic Push "press"/Push "extension"/Pull "curl" rules.
    expect(classifyExerciseCategory("Leg Press")).toBe("Legs");
    expect(classifyExerciseCategory("Leg Curl")).toBe("Legs");
    expect(classifyExerciseCategory("Seated Leg Extension")).toBe("Legs");
    // "Rowing Machine" must not fall to the generic Pull "row" rule.
    expect(classifyExerciseCategory("30 Minute Rowing Machine")).toBe("Cardio");
  });

  it("does not let a short substring inside an unrelated word misfire", () => {
    // "Lat Raise" (shoulders) must resolve to Push, not Pull via a bare
    // "lat" substring match — this is exactly why "lat" alone is not a
    // keyword in the classifier.
    expect(classifyExerciseCategory("Lat Raise")).toBe("Push");
  });

  it("resolves body-part stretches to Mobility, not that part's strength category", () => {
    expect(classifyExerciseCategory("Hamstring Stretch")).toBe("Mobility");
    expect(classifyExerciseCategory("Calf Stretch")).toBe("Mobility");
  });

  it("documents the deadlift judgment call: Legs, not Pull, matching this app's own Upper/Lower volume-split convention", () => {
    expect(classifyExerciseCategory("Deadlift")).toBe("Legs");
    expect(classifyExerciseCategory("Romanian Deadlift")).toBe("Legs");
    expect(classifyExerciseCategory("Sumo Deadlift")).toBe("Legs");
  });

  it("returns null for a name with no recognizable keyword", () => {
    expect(classifyExerciseCategory("Zercher Good Morning XYZ123")).toBeNull();
    expect(classifyExerciseCategory("")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(classifyExerciseCategory("BARBELL BACK SQUAT")).toBe("Legs");
    expect(classifyExerciseCategory("bench press")).toBe("Push");
  });
});
