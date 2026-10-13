import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LEVELS, buildReview, dayHeading, defaultProgramName, everySlotFilled, madeMessage, type TemplateSlot } from "@/lib/use-template";
import { STARTER_RUNGS } from "@/lib/starter-ladders";
import type { LadderRung } from "@/lib/slot-templates";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const ladder = (pattern: string): LadderRung[] => STARTER_RUNGS.filter((r) => r.pattern === pattern).map((r) => ({ exerciseName: r.exercise, rank: r.rank, tier: r.tier, unilateral: r.unilateral }));

// Ron's example week: Day 1: class A bilateral hinge; class A horizontal press; class B horizontal pull; class C biceps.
const slots: TemplateSlot[] = [
  { rowId: "d1-3", week: 1, day: 1, order: 2, patternId: "pull", patternName: "Horizontal Pull", side: null, tier: "B" },
  { rowId: "d1-1", week: 1, day: 1, order: 0, patternId: "hinge", patternName: "Hinge", side: "bilateral", tier: "A" },
  { rowId: "d1-2", week: 1, day: 1, order: 1, patternId: "press", patternName: "Horizontal Press", side: null, tier: "A" },
  { rowId: "d1-4", week: 1, day: 1, order: 3, patternId: "bi", patternName: "Elbow Flexion (Biceps)", side: null, tier: "C" },
];
const ladders = { hinge: ladder("Hinge"), press: ladder("Horizontal Press"), pull: ladder("Horizontal Pull"), bi: ladder("Elbow Flexion (Biceps)") };

describe("Use this template: the review", () => {
  it("every slot gets an exercise from its own filtered ladder, in day order", () => {
    const review = buildReview(slots, ladders, "intermediate");
    expect(review.map((r) => r.rowId)).toEqual(["d1-1", "d1-2", "d1-3", "d1-4"]);
    for (const r of review) {
      expect(r.pick, r.label).not.toBeNull();
      expect(r.choices.map((c) => c.exerciseName)).toContain(r.pick);
      expect(r.fallback).toBeNull();
    }
    const hinge = review[0];
    expect(hinge.label).toBe("Hinge · Bilateral · Class A");
    expect(hinge.choices.every((c) => c.tier === "A" && !c.unilateral)).toBe(true);
  });
  it("the level moves the pick up the ladder: beginner no higher than intermediate, no higher than advanced", () => {
    const rank = (level: "beginner" | "intermediate" | "advanced") => {
      const row = buildReview(slots, ladders, level)[1];
      return row.choices.findIndex((c) => c.exerciseName === row.pick);
    };
    expect(rank("beginner")).toBeLessThanOrEqual(rank("intermediate"));
    expect(rank("intermediate")).toBeLessThanOrEqual(rank("advanced"));
    expect(rank("beginner")).toBeLessThan(rank("advanced"));
  });
  it("a pattern with no exercises blocks Make until the coach fixes it", () => {
    const review = buildReview(slots, { ...ladders, bi: [] }, "intermediate");
    const biceps = review.find((r) => r.rowId === "d1-4")!;
    expect(biceps.pick).toBeNull();
    expect(biceps.choices).toEqual([]);
    expect(everySlotFilled(review, {})).toBe(false);
    expect(everySlotFilled(buildReview(slots, ladders, "intermediate"), {})).toBe(true);
  });
  it("a pick the coach changed by hand counts", () => {
    const review = buildReview(slots, { ...ladders, bi: [] }, "intermediate");
    expect(everySlotFilled(review, { "d1-4": "Barbell Curl" })).toBe(true);
  });
  it("names and messages", () => {
    expect(LEVELS.map((l) => l.label)).toEqual(["Beginner", "Intermediate", "Advanced"]);
    expect(defaultProgramName("Upper Lower", "advanced")).toBe("Upper Lower (Advanced)");
    expect(dayHeading(2, 3)).toBe("Week 2, Day 3");
    expect(madeMessage("Upper Lower (Advanced)")).toBe("Made “Upper Lower (Advanced)”. It's in your Programs.");
  });
});

describe("Use this template: it makes a normal program and never touches the template", () => {
  const panel = read("components/coach/desktop/use-template-panel.tsx");
  const menu = read("components/coach/desktop/program-card-menu.tsx");
  it("copies the template, replaces each slot with the chosen real exercise (pattern kept), cleans up on failure, then optionally assigns", () => {
    expect(panel).toContain("duplicateProgram(supabase, { sourceProgramId: programId, destinationGroupId: groupId, createdBy: user.id })");
    expect(panel).toContain("exercise_name: exercise, is_slot: false, slot_side: null, slot_tier: null");
    expect(panel).not.toContain("movement_pattern_id: null");
    expect(panel).toContain('await supabase.from("programs").delete().eq("id", copyId)');
    expect(panel).toContain("assignProgramToClient(supabase, { sourceProgramId: copyId");
    // the template itself is only ever read
    expect(panel).not.toContain('.update({ exercise_name: exercise, is_slot: false, slot_side: null, slot_tier: null, display_name: null }).eq("id", r.rowId)');
  });
  it("the strings are the agreed ones", () => {
    for (const t of ["Use this template", "Pick a level and the exercises are chosen from your ladders. Look them over, change any, then make the program.", "No one yet (keep it in my library)", "For a client (optional)", "Program name", "Make the program", "Make and assign to ${firstName}", "Making…"]) expect(panel).toContain(t);
  });
  it("a template card offers Use this template instead of Assign", () => {
    expect(menu).toContain("Use this template…");
    expect(menu).toContain("showAssignButton && !isTemplate");
    expect(read("components/coach/desktop/program-card-grid.tsx")).toContain("slotCount={program.slotCount ?? 0}");
  });
});

describe("Use this template: nothing is taken back once the client has their copy", () => {
  it("the cleanup only runs before the assignment succeeded", () => {
    const panel = read("components/coach/desktop/use-template-panel.tsx");
    expect(panel).toContain("let clientHasCopy = false;");
    expect(panel).toContain("clientHasCopy = true;");
    expect(panel.indexOf("if (clientHasCopy) {")).toBeLessThan(panel.indexOf('await supabase.from("programs").delete().eq("id", copyId)'));
  });
});
