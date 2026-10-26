import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { aliasRawNameFor, allMatchesChosen, libraryTwin, matchLabel, preselectUseRaw } from "./import-match-review";

// Ron, Oct 26 (import review): "not all of these are 100percent matches". A remembered match ("Barbell Bench Press" -> Barbell Overhead Press, saved by an old import) read "(100% match)".
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const wizard = read("components/coach/desktop/import-wizard.tsx");

describe("a remembered match says so, instead of a percentage", () => {
  it("an alias row reads 'you matched this before'; a guess keeps its percentage", () => {
    expect(matchLabel({ fromAlias: true, score: 1 })).toBe("you matched this before");
    expect(matchLabel({ fromAlias: false, score: 0.934 })).toBe("93% match");
    expect(wizard).toContain("({matchLabel(f)})");
    expect(wizard).not.toContain("({Math.round(f.score * 100)}% match)");
  });
});

describe("turning a remembered match down forgets it", () => {
  it("the stored alias is found by the same comparison the matcher uses", () => {
    const aliases = [{ rawName: "barbell bench press", exerciseName: "Barbell Overhead Press" }, { rawName: "Cossack deadlift", exerciseName: "Conventional Deadlift" }];
    expect(aliasRawNameFor("Barbell Bench Press", aliases)).toBe("barbell bench press");
    expect(aliasRawNameFor("cossack  deadlift", aliases)).toBe("Cossack deadlift");
    expect(aliasRawNameFor("Goblet Squat", aliases)).toBeNull();
  });
  it("'Add as its own new exercise' on an alias row deletes that alias (the coach's own, by its stored name)", () => {
    expect(wizard).toContain("if (f.fromAlias && f.aliasRawName) aliasesToForget.push(f.aliasRawName);");
    expect(wizard).toContain('supabase.from("exercise_aliases").delete().eq("coach_id", coachId).in("raw_name", aliasesToForget)');
    // a match the coach keeps is saved as before
    expect(wizard).toContain("newAliases.push({ rawName: f.key, exerciseName: f.matchedTo });");
  });
});

describe("a weak guess is never picked for the coach", () => {
  it("under 90% starts unpicked; 90% and up, and a remembered match, start on the match", () => {
    expect(preselectUseRaw("fuzzy", 0.89)).toBeNull();
    expect(preselectUseRaw("fuzzy", 0.9)).toBe(false);
    expect(preselectUseRaw("alias", 1)).toBe(false);
    expect(wizard).toContain("useRaw: preselectUseRaw(match.confidence, match.score),");
  });
  it("the program is not created until every row is chosen", () => {
    expect(allMatchesChosen([{ useRaw: false }, { useRaw: true }])).toBe(true);
    expect(allMatchesChosen([{ useRaw: false }, { useRaw: null }])).toBe(false);
    expect(wizard).toContain("disabled={finalizing || !allMatchesChosen(pending.fuzzyMatches)}");
    expect(wizard).toContain("if (finalizing || !allMatchesChosen(importData.fuzzyMatches)) return;");
    expect(wizard).toContain("checked={f.useRaw === false}");
    expect(wizard).toContain("checked={f.useRaw === true}");
  });
});

describe("an exercise already in the library always wins over an old remembered match (Ron: \"we have barbell bench press in the library already\")", () => {
  const library = [{ name: "Barbell Bench Press" }, { name: "Barbell Overhead Press" }, { name: "Cossack Deadlift" }, { name: "Conventional Deadlift" }];
  const badAliases = [{ rawName: "barbell bench press", exerciseName: "Barbell Overhead Press" }, { rawName: "cossack deadlift", exerciseName: "Conventional Deadlift" }];
  it("the import's matcher: the library's own exercise, as an exact match (so it is not even shown for review)", async () => {
    const { matchExercise } = await import("./exercise-matching");
    expect(matchExercise("Barbell Bench Press", library, badAliases)).toEqual({ exerciseName: "Barbell Bench Press", confidence: "exact", score: 1 });
    expect(matchExercise("cossack deadlifts", library, badAliases)).toMatchObject({ exerciseName: "Cossack Deadlift", confidence: "exact" });
    // an alias still works for a name the library does not have
    expect(matchExercise("BB bench", library, [{ rawName: "BB bench", exerciseName: "Barbell Bench Press" }])).toMatchObject({ exerciseName: "Barbell Bench Press", confidence: "alias" });
    // only fuzzy and remembered matches go to review
    expect(wizard).toContain('if (match.confidence === "fuzzy" || match.confidence === "alias") {');
  });
  it("the ranked candidates put the library's own exercise first too", async () => {
    const { matchTopN } = await import("./exercise-matching");
    expect(matchTopN("Barbell Bench Press", library, badAliases)[0]).toEqual({ exerciseName: "Barbell Bench Press", score: 1, isAlias: false });
  });
  it("the AI builders (and changing later weeks) keep the library's exercise for a name the coach typed", async () => {
    const { resolveAiExerciseName, plainLibraryName } = await import("./ai-day-rules");
    const names = library.map((l) => l.name);
    const r = resolveAiExerciseName({ exerciseName: "Barbell Bench Press" }, "barbell bench press 3x8", library, badAliases, (n) => plainLibraryName(n, names));
    expect(r.name).toBe("Barbell Bench Press");
    const ai = resolveAiExerciseName({ exerciseName: "Cossack Deadlift" }, "lower body day", library, badAliases, (n) => plainLibraryName(n, names));
    expect(ai.name).toBe("Cossack Deadlift");
    expect(read("app/api/ai/edit-weeks/route.ts")).toContain("resolveAiExerciseName({ exerciseName: name }, sayings, libraryList, aliases,");
  });
  it("turning a guess down never makes a copy of an exercise the library has: it reads Use your <name> and uses it", () => {
    expect(libraryTwin("Bench Press, Barbell", ["Barbell Bench Press", "Barbell Overhead Press"])).toBe("Barbell Bench Press");
    expect(libraryTwin("barbell bench presses", ["Barbell Bench Press"])).toBe("Barbell Bench Press");
    expect(libraryTwin("Zercher Squat", ["Barbell Bench Press"])).toBeNull();
    expect(wizard).toContain("{f.twin ? <>Use your {f.twin}</> : <>Add &ldquo;{f.rawName}&rdquo; as its own new exercise instead</>}");
    expect(wizard).toContain("resolutions.set(f.key, { exerciseName: f.twin ?? trimmed, trackedFields: f.trackedFields });");
    expect(wizard).toContain("if (!f.twin) createdExercises.push(trimmed);");
  });
});
