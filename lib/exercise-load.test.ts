import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isNoLoadExercise } from "@/lib/exercise-load";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("exercises that are never loaded or rated", () => {
  it("Shoulder CARs, Foam Rolling, a plank hold and other mobility work are no-load", () => {
    for (const n of ["Shoulder CARs", "Hip CARs", "Foam Rolling", "Front Plank to Side Plank", "Plank Hold", "Couch Stretch", "Cat Cow", "Upright Squat Sits", "Thoracic Rotation Stretch (Lunge)", "Hanging L-Sit Hold"]) {
      expect(isNoLoadExercise(n), n).toBe(true);
    }
  });
  it("a back squat and other strength work keep weight and RPE", () => {
    for (const n of ["Back Squat", "Barbell Bench Press", "Dumbbell Romanian Deadlift", "Dip", "Barbell Overhead Press", "Weighted Plank", "Farmer's Carry", "Cable Face Pull"]) {
      expect(isNoLoadExercise(n), n).toBe(false);
    }
  });
});

describe("the logger", () => {
  const card = read("components/logging/exercise-card.tsx");
  const grid = read("components/logging/exercise-set-grid.tsx");
  const complete = read("components/session/complete-workout-button.tsx");
  const logger = read("components/logging/session-logger.tsx");
  it("hides weight and RPE for a no-load exercise and offers a link to add them", () => {
    expect(card).toContain("isNoLoadExercise(exercise.exerciseName)");
    expect(card).toContain('exercise.trackedFields.filter((f) => f !== "weight" && f !== "rpe")');
    expect(card).toContain("Add weight / RPE");
    expect(card).toContain("trackedFields={gridFields}");
  });
  it("the check on a set completes it whether or not anything is filled in", () => {
    expect(grid).toContain("function toggleCheck(set: SetLogEntry)");
    expect(grid).toContain('onSetChange(set.id, { status: "completed" })');
    expect(grid).toContain('set.status === "completed" && !forced');
  });
  it("Complete workout completes whatever is filled in (the choice never asks for a value), and a no-load session does not ask for an effort score", () => {
    expect(complete).toContain("Complete workout");
    expect(complete).not.toContain("fully filled in");
    expect(logger).toContain("raised && !exercises.every((e) => isNoLoadExercise(e.exerciseName))");
  });
});

describe("review fixes", () => {
  it("a hang clean, a hang power clean, a pull-up and a chin-up keep weight and RPE; a dead hang does not", () => {
    for (const n of ["Hang Clean", "Hang Power Clean", "Hang Snatch", "Pull-Up", "Chin-Up", "Weighted Pull Up"]) {
      expect(isNoLoadExercise(n), n).toBe(false);
    }
    expect(isNoLoadExercise("Dead Hang")).toBe(true);
  });
  it("a completed set with empty fields stays completed when the page loads (the revert needs the person to have changed a field this session)", () => {
    const grid = read("components/logging/exercise-set-grid.tsx");
    expect(grid).toContain('set.status === "completed" && !forced && touched');
  });
});
