import { describe, expect, it } from "vitest";
import { isConditioningExercise } from "./cardio-presets";

describe("isConditioningExercise", () => {
  it("knows conditioning machines and work", () => {
    for (const n of ["Assault Bike", "Echo Bike sprints", "Airdyne", "Rower", "Row Erg", "SkiErg", "Ski Erg", "Bike intervals", "Battle Ropes", "Burpees", "Sled Push", "Jump Rope", "Stair Climber"]) {
      expect(isConditioningExercise(n), n).toBe(true);
    }
  });
  it("leaves lifts, stretches and carries alone", () => {
    for (const n of ["Bent Over Row", "Chest Supported Row", "Crunch", "Kettlebell Swing", "Suitcase Carries", "Hamstring Stretch", "Back Squat", "Running"]) {
      expect(isConditioningExercise(n), n).toBe(false);
    }
  });
});
