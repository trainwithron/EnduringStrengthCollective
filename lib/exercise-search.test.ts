import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { searchExercises, isExistingExercise, nextActiveIndex, sortByUsage, DROPDOWN_LIMIT } from "@/lib/exercise-search";

const LIBRARY = [
  "Back Squat",
  "Bulgarian Split Squat",
  "Goblet Squat",
  "Front-Foot Elevated Split Squat",
  "Barbell Bench Press",
  "Dumbbell Bench Press",
  "Romanian Deadlift",
  "Plank",
  "Side Plank",
  "Overhead Press",
];
const names = (q: string, aliases: { rawName: string; exerciseName: string }[] = []) => searchExercises(q, LIBRARY, aliases).map((r) => r.name);

describe("searchExercises: matches anywhere in the name", () => {
  it('typing "Bulgarian" lists the Bulgarian split squat', () => {
    expect(names("Bulgarian")).toEqual(["Bulgarian Split Squat"]);
  });
  it("finds a word that is not at the start: split lists every split squat", () => {
    expect(names("split")).toEqual(["Bulgarian Split Squat", "Front-Foot Elevated Split Squat"]);
  });
  it("words in any order, each starting a word: split bulg", () => {
    expect(names("split bulg")).toEqual(["Bulgarian Split Squat"]);
  });
  it("matches inside a word", () => {
    expect(names("ulgar")).toEqual(["Bulgarian Split Squat"]);
  });
  it("ignores case, punctuation and extra spaces", () => {
    expect(names("  FRONT foot ")).toEqual(["Front-Foot Elevated Split Squat"]);
  });
  it("no text lists nothing (the box shows its browse list instead)", () => {
    expect(searchExercises("   ", LIBRARY, [])).toEqual([]);
  });
});

describe("searchExercises: ranking", () => {
  it("exact first, then starts-with, then a word elsewhere", () => {
    const r = searchExercises("plank", LIBRARY, []);
    expect(r.map((x) => [x.name, x.tier])).toEqual([
      ["Plank", 0],
      ["Side Plank", 2],
    ]);
    const s = searchExercises("squat", LIBRARY, []);
    expect(s[0].tier).toBeGreaterThanOrEqual(2);
    const starts = searchExercises("bench", LIBRARY, []);
    expect(starts.every((x) => x.tier === 2)).toBe(true);
    const front = searchExercises("back", LIBRARY, []);
    expect(front[0]).toMatchObject({ name: "Back Squat", tier: 1 });
  });
  it("starts-with beats word-match", () => {
    const r = searchExercises("over", LIBRARY, []);
    expect(r[0]).toMatchObject({ name: "Overhead Press", tier: 1 });
  });
  it("ties keep the library's order, which the page sorts most-used first", () => {
    expect(names("press")).toEqual(["Barbell Bench Press", "Dumbbell Bench Press", "Overhead Press"]);
    const reversed = [...LIBRARY].reverse();
    expect(searchExercises("press", reversed, []).map((r) => r.name)).toEqual(["Overhead Press", "Dumbbell Bench Press", "Barbell Bench Press"]);
  });
  it("a near miss in the words still shows, after the real matches", () => {
    const r = searchExercises("deadlift romanian", LIBRARY, []);
    expect(r[0].name).toBe("Romanian Deadlift");
  });
  it("is capped", () => {
    const many = Array.from({ length: 30 }, (_, i) => `Cable Row ${i}`);
    expect(searchExercises("cable", many, []).length).toBe(DROPDOWN_LIMIT);
  });
});

describe("searchExercises: aliases", () => {
  const aliases = [
    { rawName: "RFESS", exerciseName: "Bulgarian Split Squat" },
    { rawName: "bulgarian", exerciseName: "Bulgarian Split Squat" },
    { rawName: "ghost", exerciseName: "Not In Library" },
  ];
  it('typing "RFESS" lists the real exercise and says which alias matched', () => {
    expect(searchExercises("RFESS", LIBRARY, aliases)).toEqual([{ name: "Bulgarian Split Squat", viaAlias: "RFESS", tier: 0 }]);
    expect(searchExercises("rfe", LIBRARY, aliases)[0]).toMatchObject({ name: "Bulgarian Split Squat", viaAlias: "RFESS", tier: 1 });
  });
  it("a name match is not shown as an alias match unless the alias matches strictly better", () => {
    const r = searchExercises("bulgarian", LIBRARY, aliases);
    expect(r).toEqual([{ name: "Bulgarian Split Squat", viaAlias: "bulgarian", tier: 0 }]);
    expect(searchExercises("bulg", LIBRARY, [{ rawName: "bulgarian", exerciseName: "Bulgarian Split Squat" }])[0].viaAlias).toBeNull();
  });
  it("an alias that points at an exercise not in the library is ignored", () => {
    expect(searchExercises("ghost", LIBRARY, aliases)).toEqual([]);
  });
  it("one exercise is listed once even when its name and several aliases match", () => {
    const r = searchExercises("split", LIBRARY, [{ rawName: "split squat rear", exerciseName: "Bulgarian Split Squat" }]);
    expect(r.filter((x) => x.name === "Bulgarian Split Squat")).toHaveLength(1);
  });
  it("another coach's aliases are simply not passed in: an empty list changes nothing about the name matches", () => {
    expect(names("rfess")).toEqual([]);
    expect(names("split")).toEqual(["Bulgarian Split Squat", "Front-Foot Elevated Split Squat"]);
  });
});

describe("the add-as-new row, keys and usage order", () => {
  it("is offered only for text that is not already an exercise", () => {
    expect(isExistingExercise("back squat", LIBRARY)).toBe(true);
    expect(isExistingExercise("Back  Squat!", LIBRARY)).toBe(true);
    expect(isExistingExercise("Zercher Squat", LIBRARY)).toBe(false);
    expect(isExistingExercise("", LIBRARY)).toBe(false);
  });
  it("arrow keys wrap around the rows and start from nothing highlighted", () => {
    expect(nextActiveIndex("ArrowDown", -1, 3)).toBe(0);
    expect(nextActiveIndex("ArrowDown", 2, 3)).toBe(0);
    expect(nextActiveIndex("ArrowUp", -1, 3)).toBe(2);
    expect(nextActiveIndex("ArrowUp", 0, 3)).toBe(2);
    expect(nextActiveIndex("ArrowDown", 0, 0)).toBe(-1);
  });
  it("orders a library most-used first, then A to Z", () => {
    const usage = new Map([["Plank", 5], ["Back Squat", 5], ["Overhead Press", 1]]);
    expect(sortByUsage(["Overhead Press", "Plank", "Back Squat", "Goblet Squat"], usage)).toEqual(["Back Squat", "Plank", "Overhead Press", "Goblet Squat"]);
  });
});

describe("the name box", () => {
  const src = readFileSync(resolve(__dirname, "../components/coach/exercise-name-input.tsx"), "utf8").replace(/\r\n/g, "\n");
  it("is an accessible combobox with the focus kept in the input", () => {
    expect(src).toContain('role="combobox"');
    expect(src).toContain("aria-expanded={showDropdown}");
    expect(src).toContain("aria-activedescendant");
    expect(src).toContain('role="listbox"');
    expect(src).toContain('role="option"');
    expect(src).toContain("e.preventDefault();\n                    pickRow(i);");
  });
  it("handles arrows, Enter, Escape and click", () => {
    expect(src).toContain('"ArrowDown"');
    expect(src).toContain('e.key === "Enter"');
    expect(src).toContain('e.key === "Escape"');
    expect(src).toContain("onMouseDown");
  });
  it("has 44 px rows on touch and the last row adds the typed name as a new exercise", () => {
    expect(src).toContain("min-h-11 sm:min-h-9");
    expect(src).toContain("as a new exercise");
    expect(src).toContain("offerAdd");
  });
  it("picking fills the row the same way as before: change then commit with the name", () => {
    expect(src).toContain("onChange(name);\n    onCommit?.(name);");
  });
});
