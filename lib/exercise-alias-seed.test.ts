import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ALIAS_GROUPS, mergeAliases, resolveTypedAlias, seedAliasesFor } from "@/lib/exercise-alias-seed";
import { searchExercises } from "@/lib/exercise-search";

const LIB = ["Bulgarian Split Squat", "Front Foot Elevated Split Squat", "Romanian Deadlift", "Overhead Press", "Dumbbell Bench Press", "Goblet Squat", "Plank"];

describe("the built-in aliases (definitively the same movement only)", () => {
  it("every group says why its names are one exercise", () => {
    expect(ALIAS_GROUPS.length).toBeGreaterThan(8);
    for (const g of ALIAS_GROUPS) {
      expect(g.names.length).toBeGreaterThanOrEqual(2);
      expect(g.why.length).toBeGreaterThan(10);
    }
  });
  it("never lists a variation as an alias of its base exercise", () => {
    const all = ALIAS_GROUPS.flatMap((g) => g.names.map((n) => n.toLowerCase()));
    for (const variation of ["front foot elevated split squat", "goblet squat", "dumbbell overhead press", "dumbbell bench press", "incline bench press", "front squat", "sumo deadlift"]) {
      expect(all, variation).not.toContain(variation);
    }
  });
  it("RFESS and the other names point at the library's Bulgarian split squat", () => {
    const seeds = seedAliasesFor(LIB);
    const toBulgarian = seeds.filter((a) => a.exerciseName === "Bulgarian Split Squat").map((a) => a.rawName);
    expect(toBulgarian).toEqual(expect.arrayContaining(["RFESS", "Rear Foot Elevated Split Squat", "RFE Split Squat"]));
  });
  it("a library that holds the OTHER name gets the aliases pointing at that one", () => {
    const seeds = seedAliasesFor(["Rear Foot Elevated Split Squat"]);
    expect(seeds.find((a) => a.rawName === "RFESS")?.exerciseName).toBe("Rear Foot Elevated Split Squat");
    expect(seeds.find((a) => a.rawName === "Bulgarian Split Squat")?.exerciseName).toBe("Rear Foot Elevated Split Squat");
  });
  it("a name that is already its own exercise in the library is never turned into an alias", () => {
    const seeds = seedAliasesFor(["Bulgarian Split Squat", "Rear Foot Elevated Split Squat"]);
    expect(seeds.find((a) => a.rawName === "Rear Foot Elevated Split Squat")).toBeUndefined();
    expect(seeds.find((a) => a.rawName === "Bulgarian Split Squat")).toBeUndefined();
  });
  it("the variation stays its own exercise and gets no alias", () => {
    const seeds = seedAliasesFor(LIB);
    expect(seeds.some((a) => a.exerciseName === "Front Foot Elevated Split Squat" || a.rawName === "Front Foot Elevated Split Squat")).toBe(false);
  });
  it("a library with none of a group's exercises gets nothing from it", () => {
    expect(seedAliasesFor(["Plank"])).toEqual([]);
  });
  it("abbreviations: RDL and OHP", () => {
    const seeds = seedAliasesFor(LIB);
    expect(seeds.find((a) => a.rawName === "RDL")?.exerciseName).toBe("Romanian Deadlift");
    expect(seeds.find((a) => a.rawName === "OHP")?.exerciseName).toBe("Overhead Press");
  });
});

describe("merged with the coach's own aliases", () => {
  it("the coach's alias wins over a built-in one with the same name", () => {
    const coach = [{ rawName: "RFESS", exerciseName: "Front Foot Elevated Split Squat" }];
    const merged = mergeAliases(coach, LIB);
    expect(merged.filter((a) => a.rawName === "RFESS")).toEqual(coach);
  });
  it("another coach's aliases are simply not passed in", () => {
    expect(mergeAliases([], LIB).every((a) => a.exerciseName !== "Goblet Squat")).toBe(true);
  });
});

describe("typing an alias", () => {
  const aliases = mergeAliases([{ rawName: "Split squat (back foot up)", exerciseName: "Bulgarian Split Squat" }], LIB);
  it("is found by the dropdown and lists the real exercise with the alias beside it", () => {
    const r = searchExercises("RFESS", LIB, aliases);
    expect(r[0]).toMatchObject({ name: "Bulgarian Split Squat", viaAlias: "RFESS", tier: 0 });
  });
  it("typed in full and left, it resolves to the real exercise and the name to show", () => {
    expect(resolveTypedAlias("rfess", LIB, aliases)).toEqual({ exerciseName: "Bulgarian Split Squat", displayName: "RFESS" });
    expect(resolveTypedAlias("Split squat (back foot up)", LIB, aliases)).toEqual({ exerciseName: "Bulgarian Split Squat", displayName: "Split squat (back foot up)" });
  });
  it("a real exercise name, or something unknown, is not an alias", () => {
    expect(resolveTypedAlias("Bulgarian Split Squat", LIB, aliases)).toBeNull();
    expect(resolveTypedAlias("Zercher Squat", LIB, aliases)).toBeNull();
    expect(resolveTypedAlias("", LIB, aliases)).toBeNull();
  });
  it("DB, BB and OHP typed as shorthand find the full names", () => {
    expect(searchExercises("db bench", LIB, []).map((r) => r.name)).toEqual(["Dumbbell Bench Press"]);
    expect(searchExercises("ohp", LIB, []).map((r) => r.name)).toContain("Overhead Press");
  });
});

const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8").replace(/\r\n/g, "\n");

describe("the coach's name travels: saved, shown, copied", () => {
  it("picking through an alias saves the real exercise and the alias; any other rename clears the alias", () => {
    const card = read("../components/coach/exercise-builder-card.tsx");
    expect(card).toContain(".update({ exercise_name: trimmed, display_name: display })");
    expect(card).toContain("onUpdate({ exerciseName: trimmed, displayName: display });");
    expect(card).toContain("useState(exercise.displayName ?? exercise.exerciseName)");
    const box = read("../components/coach/exercise-name-input.tsx");
    expect(box).toContain("if (alias) onCommit?.(name, alias);");
    expect(box).toContain("resolveTypedAlias(text, suggestions, aliases)");
  });
  it("the builder shows the coach's name (card, collapsed card, preview), keeping the real name as the tooltip", () => {
    expect(read("../components/coach/exercise-builder-card.tsx")).toContain("exercise.displayName ?? (exercise.exerciseName || \"Exercise\")");
    expect(read("../components/coach/desktop/client-preview.tsx")).toContain("exercise.displayName ?? (exercise.exerciseName || \"Exercise\")");
  });
  it("the client's workout page and the logger show it", () => {
    expect(read("../lib/workout-overview-data.ts")).toContain("display_name");
    expect(read("../lib/workout-overview-data.ts")).toContain("overrideNameBySlot.has(ex.id) ? null");
    expect(read("../components/logging/pre-start-exercise-row.tsx")).toContain("exercise.displayName ?? exercise.exerciseName");
    expect(read("../components/logging/exercise-card.tsx")).toContain("exercise.displayName ?? (exercise.exerciseName || \"Untitled exercise\")");
  });
  it("the logger shows it only while the session exercise is still the program's exercise; a swap clears it", () => {
    expect(read("../app/sessions/[sessionId]/page.tsx")).toContain("se.group_workout_exercises.exercise_name === se.exercise_name");
    expect(read("../components/logging/session-logger.tsx")).toContain("displayName: null, isSwapped: true");
  });
  it("every lookup still uses the real exercise: history, records and last time are keyed by exercise_name", () => {
    const page = read("../app/sessions/[sessionId]/page.tsx");
    expect(page).toContain("priorBestByExerciseName.get(se.exercise_name)");
    expect(page).toContain('.in("session_exercises.exercise_name", exerciseNamesInSession)');
  });
  it("copying an exercise, a day or a week in the builder carries the name along", () => {
    expect(read("../components/coach/exercise-builder-card.tsx")).toContain("display_name: exercise.displayName,");
    const weeks = read("../components/coach/desktop/duplicate-week-panel.tsx");
    expect(weeks).toContain("display_name: first.displayName,");
    expect(weeks).toContain("display_name: intervalTrack.displayName,");
  });
  it("the builder loads the name and merges the built-in aliases into the coach's own at read time (nothing stored)", () => {
    const data = read("../lib/program-builder-data.ts");
    expect(data).toContain("display_name,");
    expect(data).toContain("mergeAliases(exerciseAliases, exerciseLibrary)");
  });
});
