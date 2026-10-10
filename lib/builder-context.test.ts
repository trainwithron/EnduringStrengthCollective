import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildProgrammingProfile, libraryContext, mentionsExercise, rankLibrary, type LibraryItem } from "@/lib/builder-context";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");
const item = (name: string, over: Partial<LibraryItem> = {}): LibraryItem => ({ name, category: null, pattern: null, tier: null, ...over });

describe("does the description name an exercise", () => {
  it("matches whole words only", () => {
    expect(mentionsExercise("Do back squats and rows", "Row")).toBe(false);
    expect(mentionsExercise("Do back squats and row variations", "Row")).toBe(true);
    expect(mentionsExercise("an arrow drill", "Row")).toBe(false);
    expect(mentionsExercise("press day", "Overhead Press")).toBe(false);
    expect(mentionsExercise("include Overhead Press twice", "overhead press")).toBe(true);
    expect(mentionsExercise("Include overhead-press", "Overhead Press")).toBe(true);
  });
  it("an empty name never matches", () => {
    expect(mentionsExercise("anything", "")).toBe(false);
    expect(mentionsExercise("anything", "!!!")).toBe(false);
  });
});

describe("a big library is cut by relevance, not by the alphabet", () => {
  const big = [
    ...Array.from({ length: 400 }, (_, i) => item(`Aardvark Drill ${String(i).padStart(3, "0")}`)),
    item("Zercher Squat", { pattern: "Squat", tier: "A" }),
    item("Romanian Deadlift", { pattern: "Hinge", tier: "A" }),
  ];
  it("keeps everything when it fits", () => {
    expect(rankLibrary(big.slice(0, 10), "x").map((i) => i.name)).toHaveLength(10);
  });
  it("a Z exercise the description names survives the cap", () => {
    const out = rankLibrary(big, "Write a squat block with Zercher Squat", new Map(), 300);
    expect(out).toHaveLength(300);
    expect(out.map((i) => i.name)).toContain("Zercher Squat");
  });
  it("main lifts (tier A) and ones the coach already uses beat the alphabet", () => {
    const out = rankLibrary(big, "strength", new Map([["romanian deadlift", 5]]), 300);
    expect(out.map((i) => i.name)).toContain("Romanian Deadlift");
  });
});

describe("the exercise list the builder reads", () => {
  it("groups by movement pattern with tiers, then the rest by category", () => {
    const text = libraryContext(
      [item("Back Squat", { pattern: "Squat", tier: "A" }), item("Goblet Squat", { pattern: "Squat", tier: "C" }), item("Plank", { category: "Core" })],
      3
    );
    expect(text).toContain("- Squat (tier A: Back Squat; tier C: Goblet Squat)");
    expect(text).toContain("- Core, not in a movement pattern: Plank");
    expect(text).not.toContain("showing the");
  });
  it("says so when it shows only part of a bigger library", () => {
    expect(libraryContext([item("A")], 900)).toContain("showing the 1 most relevant of 900 exercises");
  });
  it("an empty library asks the builder to invent sensible names", () => {
    expect(libraryContext([], 0)).toContain("invent sensible exercise names");
  });
});

describe("how this coach programs", () => {
  const slot = (n: string) => ({ "Romanian Deadlift": "Hinge", "Single Leg RDL": "Hinge", "Overhead Press": "Vertical press", "Chin-Up": "Vertical pull", Plank: "Core" } as Record<string, string>)[n] ?? null;
  const day = [
    { name: "Romanian Deadlift", sets: 3, reps: "5" },
    { name: "Overhead Press", sets: 3, reps: "8" },
    { name: "Chin-Up", sets: 3, reps: "8" },
    { name: "Plank", sets: 2, reps: "30" },
  ];
  it("needs at least three sessions to say anything", () => {
    expect(buildProgrammingProfile([{ exercises: day }, { exercises: day }], slot)).toBeNull();
  });
  it("reports the usual session shape, the usual sets x reps and the session size", () => {
    const out = buildProgrammingProfile([{ exercises: day }, { exercises: day }, { exercises: day }, { exercises: [day[0], day[1]] }], slot)!;
    expect(out).toContain("1. Hinge > Vertical press > Vertical pull > Core (3 sessions)");
    expect(out).toContain("2. Hinge > Vertical press (1 session)");
    expect(out).toContain("Hinge 3x5");
    expect(out).toContain("Vertical press 3x8");
    expect(out).toContain("About 4 exercises per session.");
  });
  it("an exercise with no pattern counts as Other", () => {
    const out = buildProgrammingProfile([{ exercises: [{ name: "Mystery", sets: 3, reps: "10" }, day[0]] }, { exercises: [{ name: "Mystery", sets: 3, reps: "10" }, day[0]] }, { exercises: [{ name: "Mystery", sets: 3, reps: "10" }, day[0]] }], slot)!;
    expect(out).toContain("Other > Hinge");
  });
});

describe("the builder uses all of it", () => {
  const route = read("app/api/ai/generate-program/route.ts");
  it("sends patterns, tiers and categories, and the profile, and uses a whole-word match", () => {
    expect(route).toContain('.from("movement_pattern_exercises")');
    expect(route).toContain("libraryContext(shownLibrary, libraryItems.length)");
    expect(route).toContain("How this coach programs (learned from their own programs):");
    expect(route).toContain("mentionsExercise(prompt, row.exerciseName)");
    expect(route).not.toContain("promptLower.includes");
  });
  it("checks the AI's picks against the whole library, not just the part it was shown", () => {
    expect(route).toContain("const libraryNames = libraryItems.map((i) => i.name);");
    expect(route).toContain("libraryNames.map((name) => ({ name }))");
  });
  it("the profile comes only from programs that are not unsigned AI drafts", () => {
    expect(route).toContain('.eq("ai_draft", false)');
  });
  it("tells the builder to follow the coach's session shapes and let preferences choose within a slot", () => {
    expect(route).toContain("let the coach's standing preferences decide WHICH exercise");
  });
});
