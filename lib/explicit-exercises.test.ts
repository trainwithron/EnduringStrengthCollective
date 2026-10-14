import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { coachNamedExercise, plainLibraryName, resolveAiExerciseName } from "@/lib/ai-day-rules";
import { buildDaySystemPrompt, readDayResult } from "@/lib/ai-day-run";
import { sameQualifiers } from "@/lib/exercise-matching";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

const PRI = "Right Heel Lift Hemi Bridge Adductor Rock Back";
const library = ["Hip Bridge", "Single Leg Hip Bridge", "Dumbbell Bench Press", "Barbell Bench Press", "Dumbbell Curl", "Plank"].map((name) => ({ name }));
const plain = (n: string) => plainLibraryName(n, library.map((l) => l.name));

// Ron: "if someone types in a specific exercise, they should give them that exercise, even if it's not in the library" (a PRI move he might not have). The library never replaces what the coach named.
describe("an exercise the coach names is kept exactly as named", () => {
  const request = `Build a hip day. Include ${PRI} and a plank.`;
  it("a long PRI-style name stays word for word even when the library has near matches", () => {
    expect(resolveAiExerciseName({ exerciseName: PRI, coachNamed: true }, request, library, [], plain)).toEqual({ name: PRI, coachNamed: true });
    // the model forgot to mark it, but the long specific name is in the coach's own words
    expect(resolveAiExerciseName({ exerciseName: PRI }, request, library, [], plain)).toEqual({ name: PRI, coachNamed: true });
  });
  it("a name the coach typed that IS the library exercise takes the library's spelling (same exercise, so it links)", () => {
    expect(resolveAiExerciseName({ exerciseName: "dumbbell bench press", coachNamed: true }, "do dumbbell bench press", library, [], plain)).toEqual({ name: "Dumbbell Bench Press", coachNamed: true });
  });
  it("a named exercise is not a fuzzy near-match: 'Incline Dumbbell Bench Press' is not turned into 'Dumbbell Bench Press'", () => {
    expect(resolveAiExerciseName({ exerciseName: "Incline Dumbbell Bench Press", coachNamed: true }, "incline dumbbell bench press", library, [], plain).name).toBe("Incline Dumbbell Bench Press");
  });
  it("leaving an exercise OUT is not naming it", () => {
    expect(coachNamedExercise("no barbell bench press, his shoulder", "Barbell Bench Press", true)).toBe(false);
    expect(coachNamedExercise("avoid plank and push-ups", "Plank", true)).toBe(false);
  });
});

describe("an exercise the AI chose is snapped only on a confident match", () => {
  it("a vague request still snaps to the library's plainest name", () => {
    expect(resolveAiExerciseName({ exerciseName: "Dumbbell Bicep Curls (Supinated Grip)" }, "a hip mobility drill and some arms", library, [], plain)).toEqual({ name: "Dumbbell Curl", coachNamed: false });
    expect(resolveAiExerciseName({ exerciseName: "dumbbell bench press" }, "chest day", library, [], plain)).toEqual({ name: "Dumbbell Bench Press", coachNamed: false });
  });
  it("a near match that changes the implement, side or position is NOT taken", () => {
    expect(sameQualifiers("Incline Dumbbell Bench Press", "Dumbbell Bench Press")).toBe(false);
    expect(sameQualifiers("Dumbbell Bench Press", "Dumbbell Bench Press")).toBe(true);
    expect(resolveAiExerciseName({ exerciseName: "Incline Dumbbell Bench Press" }, "chest day", library, [], plain)).toEqual({ name: "Incline Dumbbell Bench Press", coachNamed: false });
  });
});

describe("the day builder is told, and keeps it", () => {
  it("the prompt says a named exercise goes in verbatim, never asked about, and a vague one comes from the library", () => {
    const prompt = buildDaySystemPrompt({ youthBlock: null, hasInjury: false });
    expect(prompt).toContain("EXACTLY as the coach wrote it");
    expect(prompt).toContain("or ask whether it exists");
    expect(prompt).toContain("choose from the library instead");
    expect(prompt).toContain('"coachNamed": boolean');
  });
  it("the flag is read from the answer", () => {
    const day = readDayResult({ title: "Hips", exercises: [{ exerciseName: PRI, sets: 2, reps: "5", coachNamed: true }, { exerciseName: "Plank", sets: 2, timeSeconds: 30 }] }, "Day 1");
    expect(day?.exercises.map((e) => e.coachNamed)).toEqual([true, false]);
  });
  it("the route resolves names with it and keeps named rows out of the 'worth a look' scan and its retry", () => {
    const route = read("app/api/ai/build-day/route.ts");
    expect(route).toContain("resolveAiExerciseName(e, sayings, libraryList, aliases");
    expect(route).toContain("tidy.filter((r) => !r.coachNamed)");
    expect(route).toContain("rows.filter((r) => !r.coachNamed)");
  });
});

describe("a custom exercise stays a normal exercise", () => {
  it("Bulk edit never touches a name, and Duplicate copies it exactly", () => {
    expect(read("components/coach/desktop/bulk-edit-day-panel.tsx")).not.toContain("exercise_name");
    expect(read("supabase/migrations/0351_duplicate_makes_library_program.sql")).toContain("e.exercise_name");
  });
  it("the builder marks one that is not in the library, with an Add to my library action; the same name links once it is added", () => {
    const card = read("components/coach/exercise-builder-card.tsx");
    expect(card).toContain("Not in your library");
    expect(card).toContain("Add to my library");
    expect(card).toContain('["exact", "alias"].includes(matchExercise(');
  });
  it("quick-add no longer swaps a typed name for a near match with a different implement, side or position", () => {
    expect(read("components/coach/desktop/day-card.tsx")).toContain('match.confidence !== "fuzzy" || sameQualifiers(typedName, match.exerciseName)');
  });
});
