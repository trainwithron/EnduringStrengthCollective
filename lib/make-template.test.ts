import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ladderFor, planTemplate, templateName, templateSummary, type LadderEntry } from "./make-template";
import { isTemplateProgram, programsForTab, tabCounts, type FilterableProgram, type ProgramsTab } from "./programs-filter";

// Ron, Oct 26: "if I have a program built, I should have the option to say make a template" and "inside the [program] library, have programs and then templates separately".
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const ladders: LadderEntry[] = [
  { exerciseName: "Goblet Squat", patternId: "sq", patternName: "Squat", tier: "B", unilateral: false },
  { exerciseName: "Bulgarian Split Squat", patternId: "sq", patternName: "Squat", tier: "A", unilateral: true },
  { exerciseName: "Romanian Deadlift", patternId: "hi", patternName: "Hinge", tier: "A", unilateral: false },
  { exerciseName: "Seated Cable Row", patternId: "hp", patternName: "Horizontal Pull", tier: "C", unilateral: false },
];
const week = [
  { id: "1", name: "Goblet Squat" },
  { id: "2", name: "Bulgarian Split Squats" },
  { id: "3", name: "Bench Press" },
  { id: "4", name: "Romanian Deadlift" },
  { id: "5", name: "Plank" },
  { id: "6", name: "Seated Cable Row" },
];

describe("each exercise on a ladder becomes a slot; the rest stay as they are", () => {
  it("a ladder hit becomes a slot with that pattern, side and class", () => {
    const plan = planTemplate(week, ladders);
    const byId = Object.fromEntries(plan.slots.map((s) => [s.id, s]));
    expect(byId["1"]).toMatchObject({ patternId: "sq", spec: { patternName: "Squat", side: null, tier: "B" }, placeholder: "Slot: Squat · Class B" });
    // the same exercise spelled differently counts, and a unilateral rung makes a unilateral slot
    expect(byId["2"]).toMatchObject({ patternId: "sq", spec: { patternName: "Squat", side: "unilateral", tier: "A" } });
    expect(byId["4"].spec).toEqual({ patternName: "Hinge", side: null, tier: "A" });
    expect(byId["6"].spec.tier).toBe("C");
  });
  it("an exercise on no ladder stays fixed and is named", () => {
    const plan = planTemplate(week, ladders);
    expect(plan.fixed).toEqual(["Bench Press", "Plank"]);
    expect(plan.slots.map((s) => s.id)).toEqual(["1", "2", "4", "6"]);
    expect(ladderFor("Zercher Squat", ladders)).toBeNull();
  });
  it("the summary line counts exercises, not rows (a program repeats them every week)", () => {
    const fourWeeks = [0, 1, 2, 3].flatMap((w) => week.map((e) => ({ id: `${w}-${e.id}`, name: e.name })));
    expect(templateSummary(planTemplate(fourWeeks, ladders))).toBe("4 of 6 exercises became slots; Bench Press and Plank stayed as they are (not on a ladder yet).");
    expect(templateSummary(planTemplate([{ id: "1", name: "Goblet Squat" }], ladders))).toBe("1 of 1 exercise became a slot.");
    expect(templateSummary(planTemplate([{ id: "1", name: "Plank" }], ladders))).toBe("0 of 1 exercise became slots; Plank stayed as it is (not on a ladder yet).");
  });
  it("the template is named after the program", () => {
    expect(templateName("Upper Lower 4 day")).toBe("Upper Lower 4 day template");
    expect(templateName("Strength template")).toBe("Strength template");
  });
});

describe("making it: a new program in the organization's library; the original never changes", () => {
  const lib = read("lib/make-template.ts");
  it("the program is copied, and only the copy is renamed, switched off, marked the organization's and given slots", () => {
    expect(lib).toContain("duplicateProgram(supabase, { sourceProgramId: programId, destinationGroupId: libraryGroupId, createdBy: coachId })");
    expect(lib).toContain('.update({ name: templateName(programName), is_active: false, ...(inLibrary ? { org_program: true } : {}) })\n    .eq("id", copy.programId);');
    expect(lib).toContain('.eq("workouts.program_id", copy.programId)');
    // a slot keeps its sets, reps, rest, effort, notes and order: only the slot fields of the exercise row change
    expect(lib).toContain(".update({ is_slot: true, movement_pattern_id: s.patternId, slot_side: s.spec.side, slot_tier: s.spec.tier, exercise_name: s.placeholder, display_name: null })");
    expect(lib).not.toMatch(/group_workout_exercise_sets/);
    expect(lib).not.toMatch(/\.eq\("id", programId\)/);
    // all or nothing: a failed step deletes the new template again
    expect(lib.match(/await undo\(\);/g)?.length).toBeGreaterThanOrEqual(3);
  });
  it("the ladders are the coach's own and the starter set (lib/coach-ladders.ts), not only patterns the coach made", () => {
    expect(lib).toContain("loadCoachLadders(supabase, coachId),");
    expect(lib).toContain("const plan = planTemplate(exercises, ladderRead.ladders);");
    expect(lib).not.toContain('.eq("movement_patterns.created_by", coachId)');
  });
  it("Make a template is in the program menu (card and builder, computer and phone) for a program that is not a template, and opens the new one with the summary", () => {
    const menu = read("components/coach/desktop/program-card-menu.tsx");
    expect(menu).toContain("{!isTemplate && (");
    expect(menu).toContain("Make a template");
    expect(menu).toContain("router.push(`/groups/${made.groupId}/programs/${made.programId}?edit=1&templateNote=${encodeURIComponent(made.summary)}`);");
    expect(read("components/coach/desktop/program-builder-desktop.tsx")).toContain('slotCount={days.reduce((n, d) => n + d.items.filter((i) => i.kind === "exercise" && !!i.slot).length, 0)}');
    const page = read("app/(coach)/groups/[groupId]/programs/[programId]/page.tsx");
    expect(page).toContain("Template made. {templateNote}");
  });
});

describe("the library's two tabs", () => {
  const programs: FilterableProgram[] = [
    { id: "p1", athleteId: null, athleteName: null, sourceProgramId: null, slotCount: 0 },
    { id: "t1", athleteId: null, athleteName: null, sourceProgramId: "p1", slotCount: 4 },
    { id: "c1", athleteId: "ann", athleteName: "Ann", sourceProgramId: null, slotCount: 0 },
    { id: "c2", athleteId: "bob", athleteName: "Bob", sourceProgramId: "t1", slotCount: 4 },
  ];
  it("a template (no client, a slot) is under Templates; everything else under Programs; the counts match", () => {
    expect(isTemplateProgram(programs[1])).toBe(true);
    expect(programsForTab(programs, "templates").map((p) => p.id)).toEqual(["t1"]);
    expect(programsForTab(programs, "programs").map((p) => p.id)).toEqual(["p1", "c1", "c2"]);
    expect(tabCounts(programs)).toEqual({ programs: 2, templates: 1 } satisfies Record<ProgramsTab, number>);
  });
  it("the tabs replace the Templates filter, with the new empty text", () => {
    const list = read("components/coach/desktop/programs-list.tsx");
    expect(list).toContain('role="tablist"');
    expect(list).toContain("applyProgramsFilter(programsForTab(programs, tab), mode, value || null)");
    expect(list).not.toContain('<option value="templates">');
    expect(list).toContain("No templates yet. Open a program and choose Make a template.");
  });
});
