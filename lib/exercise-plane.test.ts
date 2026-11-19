import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXERCISE_PLANES } from "@/components/coach/movement-pattern-row";
import { patternHasPlane } from "@/components/coach/movement-pattern-list";

// Ron, Nov 19: "on each of the individual exercises, I need to be able to pick which movement plane".
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("a movement plane on each exercise of a ladder", () => {
  it("the picker's values are the ones the database accepts for an exercise (capitalized, migration 0161), so saving a ladder never fails on them", () => {
    const migration = read("supabase/migrations/0161_movement_pattern_ladders_seed_schema.sql");
    expect(migration).toContain("check (plane is null or plane = any (array['Sagittal', 'Frontal', 'Transverse', 'Multi-planar']))");
    for (const p of EXERCISE_PLANES) expect(migration).toContain(`'${p}'`);
    expect([...EXERCISE_PLANES]).toEqual(["Sagittal", "Frontal", "Transverse"]);
  });
  it("is saved with the ladder, loaded back, and picked on a line of its own under the exercise name (fits a phone)", () => {
    const row = read("components/coach/movement-pattern-row.tsx");
    expect(row).toContain("        is_unilateral: !!item.unilateral,\n        plane: item.plane ?? null,\n");
    expect(row).toContain('{patternPlane ? `Plane (${patternPlane}, from the pattern)` : "Plane"}');
    expect(row).toContain('<div className="pl-6 mt-1 flex flex-wrap items-center gap-1.5">');
    expect(row).toContain("aria-label={`Movement plane for ${item.exerciseName || `exercise ${i + 1}`}`}");
    // the pattern-level Plane buttons are gone (nothing writes the pattern's own plane from the row any more)
    expect(row).not.toContain('from("movement_patterns").update({ plane');
    const page = read("app/(coach)/groups/[groupId]/exercise-library/page.tsx");
    expect(page).toContain("movement_pattern_exercises ( id, exercise_name, difficulty_rank, tier, is_unilateral, plane )");
    expect(page).toContain("plane: (e.plane ?? null)");
  });
  it("Filter by plane shows a pattern when any of its exercises has that plane", () => {
    const pattern = { ladder: [{ plane: "Frontal" as const }, { plane: null }] };
    expect(patternHasPlane(pattern, null)).toBe(true);
    expect(patternHasPlane(pattern, "frontal")).toBe(true);
    expect(patternHasPlane(pattern, "sagittal")).toBe(false);
    expect(patternHasPlane({ ladder: [] }, "transverse")).toBe(false);
  });
});

// Review, Nov 19: a pattern none of whose exercises has a plane yet still shows under the plane the coach gave the whole pattern, and the picker says so.
import { patternHasPlane as hasPlane } from "@/components/coach/movement-pattern-list";
describe("a pattern with no exercise planes yet keeps its own plane", () => {
  it("falls back to the pattern's plane only when no exercise has one", () => {
    expect(hasPlane({ plane: "frontal", ladder: [{ plane: null }, {}] }, "frontal")).toBe(true);
    expect(hasPlane({ plane: "frontal", ladder: [{ plane: null }] }, "sagittal")).toBe(false);
    expect(hasPlane({ plane: "frontal", ladder: [{ plane: "Sagittal" }] }, "frontal")).toBe(false);
    expect(hasPlane({ plane: "frontal", ladder: [{ plane: "Sagittal" }] }, "sagittal")).toBe(true);
    expect(hasPlane({ plane: null, ladder: [] }, null)).toBe(true);
  });
});
