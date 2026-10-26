import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SLOT_ACTIVE_BLOCKED, SLOT_ASSIGN_BLOCKED, choicesForSlot, pickRung, slotLabel, slotPlaceholderName, type LadderRung } from "@/lib/slot-templates";
import { STARTER_RUNGS } from "@/lib/starter-ladders";
import { applyProgramsFilter } from "@/lib/programs-filter";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const ladder = (pattern: string): LadderRung[] => STARTER_RUNGS.filter((r) => r.pattern === pattern).map((r) => ({ exerciseName: r.exercise, rank: r.rank, tier: r.tier, unilateral: r.unilateral }));

describe("a slot reads like Ron said it", () => {
  it("pattern, side, class", () => {
    expect(slotLabel({ patternName: "Hinge", side: "unilateral", tier: "A" })).toBe("Hinge · Unilateral · Class A");
    expect(slotLabel({ patternName: "Horizontal Press", side: "bilateral", tier: "A" })).toBe("Horizontal Press · Bilateral · Class A");
    expect(slotLabel({ patternName: "Elbow Flexion (Biceps)", side: null, tier: "C" })).toBe("Elbow Flexion (Biceps) · Class C");
    expect(slotLabel({ patternName: "Squat", side: null, tier: null })).toBe("Squat");
    expect(slotPlaceholderName({ patternName: "Hinge", side: "unilateral", tier: "A" })).toBe("Slot: Hinge · Unilateral · Class A");
  });
});

describe("a slot finds its exercises on the coach's ladder", () => {
  it("the exact side and class when there are some", () => {
    const c = choicesForSlot({ patternName: "Hinge", side: "unilateral", tier: "A" }, ladder("Hinge"));
    expect(c.fallback).toBeNull();
    expect(c.rungs.map((r) => r.exerciseName)).toEqual(["Barbell Single Leg Romanian Deadlift"]);
  });
  it("his four example slots all find something without falling back", () => {
    for (const [pattern, side, tier] of [["Hinge", "bilateral", "A"], ["Horizontal Press", null, "A"], ["Horizontal Pull", null, "B"], ["Elbow Flexion (Biceps)", null, "C"]] as const) {
      const c = choicesForSlot({ patternName: pattern, side, tier }, ladder(pattern));
      expect(c.rungs.length, pattern).toBeGreaterThan(0);
      expect(c.fallback, pattern).toBeNull();
    }
  });
  it("rungs come easiest first", () => {
    const c = choicesForSlot({ patternName: "Squat", side: "bilateral", tier: "B" }, ladder("Squat"));
    const ranks = c.rungs.map((r) => r.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
  it("a class with nothing falls back to the nearest class and says so", () => {
    // Core: Extension has no unilateral rung and class A only on the weighted one.
    const c = choicesForSlot({ patternName: "Core: Flexion", side: null, tier: "B" }, ladder("Core: Flexion").filter((r) => r.tier !== "B"));
    expect(c.rungs.length).toBeGreaterThan(0);
    expect(c.fallback).toMatch(/class B/);
  });
  it("a side with nothing falls back to either side and says so; an empty ladder says nothing fits", () => {
    const c = choicesForSlot({ patternName: "Core: Flexion", side: "unilateral", tier: null }, ladder("Core: Flexion"));
    expect(c.rungs.length).toBeGreaterThan(0);
    expect(c.fallback).toMatch(/either side/);
    expect(choicesForSlot({ patternName: "Squat", side: null, tier: "A" }, []).fallback).toBe("Nothing on this ladder fits.");
  });
});

describe("the level picks the rung; it starts in the middle", () => {
  const rungs = ladder("Squat").filter((r) => !r.unilateral && r.tier === "B").sort((a, b) => a.rank - b.rank) as LadderRung[];
  it("no level means the middle of the ladder", () => {
    expect(pickRung(rungs)).toEqual(rungs[Math.round((rungs.length - 1) * 0.5)]);
  });
  it("beginner is lower than intermediate, which is lower than advanced", () => {
    const idx = (l: "beginner" | "intermediate" | "advanced") => rungs.indexOf(pickRung(rungs, l)!);
    expect(idx("beginner")).toBeLessThanOrEqual(idx("intermediate"));
    expect(idx("intermediate")).toBeLessThanOrEqual(idx("advanced"));
    expect(idx("beginner")).toBeLessThan(idx("advanced"));
  });
  it("an empty list picks nothing", () => {
    expect(pickRung([])).toBeNull();
  });
});

describe("templates under Programs", () => {
  const p = (id: string, slotCount: number, athleteId: string | null = null) => ({ id, athleteId, athleteName: null, slotCount });
  it("the Templates filter shows library programs that contain a slot, never a client's program", () => {
    const all = [p("a", 2), p("b", 0), p("c", 1, "client-1")];
    expect(applyProgramsFilter(all, "templates", null).map((x) => x.id)).toEqual(["a"]);
  });
  it("the page, the filter and the card are wired", () => {
    // the Templates tab (Oct 26) took the place of the filter option
    expect(read("components/coach/desktop/programs-list.tsx")).toContain("applyProgramsFilter(programsForTab(programs, tab), mode, value || null)");
    expect(read("components/coach/desktop/programs-list.tsx")).toContain("No templates yet. Open a program and choose Make a template.");
    expect(read("components/coach/desktop/program-card-grid.tsx")).toContain("Template, {program.slotCount}");
    expect(read("app/(coach)/programs/page.tsx")).toContain('.eq("is_slot", true)');
  });
});

describe("the slot builder", () => {
  const dayCard = read("components/coach/desktop/day-card.tsx");
  const slotCard = read("components/coach/desktop/slot-card.tsx");
  it("a day has + Slot beside + Exercise and + Note, and a slot is drawn by its own card", () => {
    expect(dayCard).toContain("+ Slot");
    expect(dayCard).toContain("<AddSlotForm");
    expect(dayCard).toContain("<SlotCard");
    expect(dayCard).toContain("i.kind === \"exercise\" && !i.slot");
  });
  it("a slot is saved as an exercise row marked as a slot, with its pattern, side and class, and a failed first set takes it back out", () => {
    for (const t of ["is_slot: true", "slot_side: spec.side", "slot_tier: spec.tier", "movement_pattern_id: pattern.id", "Couldn't add that slot. Try again.", "The exercise is picked when you assign it.", "Add slot"]) expect(slotCard).toContain(t);
    expect(slotCard).toContain('.from("group_workout_exercises").delete().eq("id", row.id)');
  });
  it("Bulk edit, the client preview and the exercise usage ignore slots; Duplicate week copies them", () => {
    expect(read("components/coach/desktop/week-grid.tsx")).toContain('i.kind === "exercise" && !i.slot');
    expect(read("components/coach/desktop/client-preview.tsx")).toContain('i.kind === "exercise" && !i.slot');
    expect(read("lib/program-builder-data.ts")).toContain("if (ex.is_slot) continue;");
    const dup = read("components/coach/desktop/duplicate-week-panel.tsx");
    expect(dup).toContain("slotTracks.push(");
    expect(dup).toContain("is_slot: true");
  });
  it("the builder reads the slot columns in both places it reads a day", () => {
    expect(read("lib/program-builder-data.ts").match(/is_slot, slot_side, slot_tier/g)?.length).toBe(2);
  });
});

describe("a placeholder never reaches a client", () => {
  it("the message is the same in the database function and in the screen", () => {
    expect(read("supabase/migrations/0366_template_slots_survive_duplicate.sql")).toContain(SLOT_ASSIGN_BLOCKED.replace("can't", "can''t"));
    expect(SLOT_ASSIGN_BLOCKED).toBe("This template has slots. Choosing its exercises for a client comes next, so it can't be assigned yet.");
  });
  it("making a program with slots active is refused in the active toggle", () => {
    const toggle = read("components/coach/program-active-toggle.tsx");
    expect(toggle).toContain('.eq("is_slot", true)');
    expect(toggle).toContain("SLOT_ACTIVE_BLOCKED");
    expect(SLOT_ACTIVE_BLOCKED).toBe("This program has slots to fill in, so it can't be made active. Assign it to a client instead.");
  });
  it("+ Slot is offered only in a library program nobody follows, and signing off a program with slots is refused", () => {
    expect(read("lib/program-builder-data.ts")).toContain("canAddSlot: program.athlete_id === null && program.is_active === false");
    expect(read("components/coach/desktop/day-card.tsx")).toContain("{canAddSlot && (");
    const signOff = read("app/api/ai/sign-off/route.ts");
    expect(signOff).toContain("SLOT_ACTIVE_BLOCKED");
    expect(signOff).toContain('.eq("is_slot", true)');
    expect(read("supabase/migrations/0366_template_slots_survive_duplicate.sql")).toContain("and not exists (select 1 from public.workouts w join public.group_workout_exercises e on e.workout_id = w.id where w.program_id = src.id and e.is_slot)");
  });
  it("the migration copies the slot columns and refuses a client copy while a slot exists", () => {
    const sql = read("supabase/migrations/0366_template_slots_survive_duplicate.sql");
    expect(sql).toContain("is_slot, slot_side, slot_tier");
    expect(sql).toContain("p_athlete_id is not null and exists");
  });
});
