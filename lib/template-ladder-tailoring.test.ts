import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { LadderRung } from "./slot-templates";
import { buildReview, isTailored, stepRung, TAILORED_MARK, type TemplateSlot } from "./use-template";

// Ron, Oct 27: "Each exercise should have a ladder that we can quickly tailor to each individual" / "I don't think it'd be easy to build the templates out in the phone". Easier / Harder on every
// slot of Use this template (one rung on its ladder), and Start from a template on the phone (use only).
const state = vi.hoisted(() => ({ groups: [] as { id: string; orgId: string }[] }));
vi.mock("@/lib/coach-groups", () => ({
  getCoachedGroups: async () => state.groups,
  groupsInOrgOf: (groups: { id: string; orgId: string }[], groupId: string) => {
    const org = groups.find((g) => g.id === groupId)?.orgId;
    return org ? groups.filter((g) => g.orgId === org) : [];
  },
}));
const { loadOrgTemplates, NO_TEMPLATES_MESSAGE } = await import("./org-templates");

const rung = (exerciseName: string, rank: number, unilateral = false, tier: "A" | "B" | "C" | null = "A"): LadderRung => ({ exerciseName, rank, tier, unilateral });
// The hinge ladder: four bilateral class A rungs, one unilateral, one class B.
const hinge = [rung("Hip Hinge Drill", 1), rung("Kettlebell Deadlift", 2), rung("Single-Leg RDL", 3, true), rung("Romanian Deadlift", 4), rung("Good Morning", 5, false, "B"), rung("Conventional Deadlift", 6)];
const slot: TemplateSlot = { rowId: "s1", week: 1, day: 1, order: 0, patternId: "hinge", patternName: "Hinge", side: "bilateral", tier: "A" };

describe("Easier / Harder on a slot", () => {
  const [row] = buildReview([slot], { hinge }, "intermediate");
  it("moves one rung within the slot's own choices (bilateral, class A: the unilateral and class B rungs are never stepped onto)", () => {
    expect(row.choices.map((c) => c.exerciseName)).toEqual(["Hip Hinge Drill", "Kettlebell Deadlift", "Romanian Deadlift", "Conventional Deadlift"]);
    expect(stepRung(row.choices, "Kettlebell Deadlift", 1, hinge)).toBe("Romanian Deadlift");
    expect(stepRung(row.choices, "Romanian Deadlift", -1, hinge)).toBe("Kettlebell Deadlift");
    expect(stepRung(row.choices, "Romanian Deadlift", 1, hinge)).toBe("Conventional Deadlift");
  });
  it("stops at the bottom and the top (the button is then disabled)", () => {
    expect(stepRung(row.choices, "Hip Hinge Drill", -1, hinge)).toBeNull();
    expect(stepRung(row.choices, "Conventional Deadlift", 1, hinge)).toBeNull();
  });
  it("an exercise off the slot's choices (the AI's pick or your request) moves to the nearest choice below / above it by difficulty, or cannot move when its difficulty is unknown", () => {
    // on the pattern's ladder but not this slot's choices (unilateral)
    expect(stepRung(row.choices, "Single-Leg RDL", -1, hinge)).toBe("Kettlebell Deadlift");
    expect(stepRung(row.choices, "Single-Leg RDL", 1, hinge)).toBe("Romanian Deadlift");
    expect(stepRung(row.choices, "good morning", 1, hinge)).toBe("Conventional Deadlift");
    // not on any ladder
    expect(stepRung(row.choices, "Sled Pull", -1, hinge)).toBeNull();
    expect(stepRung(row.choices, "Sled Pull", 1, hinge)).toBeNull();
    // nothing chosen yet
    expect(stepRung(row.choices, "", 1, hinge)).toBeNull();
  });
  it("a level change re-picks every slot (the level's own rung), and the dropdown still lists every choice", () => {
    expect(buildReview([slot], { hinge }, "beginner")[0].pick).toBe("Kettlebell Deadlift");
    expect(buildReview([slot], { hinge }, "intermediate")[0].pick).toBe("Romanian Deadlift");
    // (with four rungs, advanced lands on the third, like intermediate: pickRung's 80% of the way up)
    expect(buildReview([slot], { hinge }, "advanced")[0].pick).toBe("Romanian Deadlift");
    expect(buildReview([slot], { hinge }, "intermediate")[0].choices).toHaveLength(4);
  });
  it("a slot moved by hand is marked changed while it differs from what the level or Pick for me chose", () => {
    expect(isTailored(true, "Kettlebell Deadlift", "Romanian Deadlift")).toBe(true);
    expect(isTailored(true, "Romanian Deadlift", "Romanian Deadlift")).toBe(false);
    expect(isTailored(false, "Kettlebell Deadlift", "Romanian Deadlift")).toBe(false);
    expect(TAILORED_MARK).toBe("changed");
  });
});

describe("the panel (computer and phone, one component)", () => {
  const panel = readFileSync(join(__dirname, "..", "components/coach/desktop/use-template-panel.tsx"), "utf8").replace(/\r\n/g, "\n");
  it("each slot has Easier and Harder beside its exercise: 44 px tall, labelled with the slot, disabled at the ends, the dropdown kept", () => {
    expect(panel).toContain("aria-label={`Easier: ${r.label}`}");
    expect(panel).toContain("aria-label={`Harder: ${r.label}`}");
    expect(panel).toContain("disabled={!easier}");
    expect(panel).toContain("disabled={!harder}");
    expect(panel.match(/className="min-h-11 px-2\.5 border/g)).toHaveLength(2);
    expect(panel).toContain("const easier = stepRung(r.choices, value, -1, ladders[r.patternId] ?? []);");
    expect(panel).toContain("onChange={(e) => choose(r.rowId, e.target.value)}");
    expect(panel).toContain("const tailored = isTailored(!!moved[r.rowId], value, ai?.exercise ?? r.pick);");
  });
  it("a new level, a stored client level and Pick for me clear the hand marks (and the level re-picks)", () => {
    expect(panel).toContain("// A new level re-picks every slot.\n                    setChanged({});\n                    setMoved({});");
    expect(panel).toContain("setChanged(next);\n      setMoved({});");
    expect(panel).toContain("setChanged({});\n          setMoved({});");
  });
});

describe("Start from a template on the phone", () => {
  type Row = Record<string, unknown>;
  function db(programs: Row[], slots: Row[], fail = false) {
    return {
      from: (table: string) => {
        let rows = table === "programs" ? programs : slots;
        const b: Record<string, unknown> = {};
        Object.assign(b, {
          select: () => b,
          in: (c: string, v: unknown[]) => ((rows = rows.filter((r) => v.includes(r[c]))), b),
          is: (c: string, v: unknown) => ((rows = rows.filter((r) => (r[c] ?? null) === v)), b),
          eq: (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] === v)), b),
          order: () => b,
          range: async () => (fail ? { data: null, error: { message: "x" } } : { data: rows, error: null }),
        });
        return b;
      },
    } as never;
  }
  state.groups = [
    { id: "team", orgId: "esc" },
    { id: "sawyer-space", orgId: "esc" },
    { id: "trojans", orgId: "trojans-org" },
  ];
  const programs = [
    { id: "t-old", name: "Big Sauce template", group_id: "team", athlete_id: null, archived_at: null, updated_at: "2026-10-20" },
    { id: "t-new", name: "Hinge day template", group_id: "sawyer-space", athlete_id: null, archived_at: null, updated_at: "2026-10-26" },
    { id: "plain", name: "Big Sauce", group_id: "team", athlete_id: null, archived_at: null, updated_at: "2026-10-27" },
    { id: "client-copy", name: "Sawyer's copy", group_id: "sawyer-space", athlete_id: "sawyer", archived_at: null, updated_at: "2026-10-27" },
    { id: "removed", name: "Old template", group_id: "team", athlete_id: null, archived_at: "2026-10-01", updated_at: "2026-10-27" },
    { id: "t-other-org", name: "Trojans template", group_id: "trojans", athlete_id: null, archived_at: null, updated_at: "2026-10-27" },
  ];
  const slot = (programId: string, group: string) => ({ id: `${programId}-s`, is_slot: true, group_id: group, workouts: { program_id: programId } });
  const slots = [slot("t-old", "team"), slot("t-old", "team"), slot("t-new", "sawyer-space"), slot("client-copy", "sawyer-space"), slot("removed", "team"), slot("t-other-org", "trojans")];

  it("lists only templates (no client, at least one slot, not removed) in the organization being worked in, newest changed first", async () => {
    expect(await loadOrgTemplates(db(programs, slots), "ron", "team")).toEqual([
      { id: "t-new", name: "Hinge day template", groupId: "sawyer-space", slotCount: 1 },
      { id: "t-old", name: "Big Sauce template", groupId: "team", slotCount: 2 },
    ]);
    expect(await loadOrgTemplates(db(programs, slots), "ron", "trojans")).toEqual([{ id: "t-other-org", name: "Trojans template", groupId: "trojans", slotCount: 1 }]);
  });
  it("none: the plain line; a failed read is said, never shown as none", async () => {
    expect(await loadOrgTemplates(db([], []), "ron", "team")).toEqual([]);
    expect(NO_TEMPLATES_MESSAGE).toBe("No templates yet. On a computer, open a program and choose Make a template.");
    expect(await loadOrgTemplates(db(programs, slots, true), "ron", "team")).toBeNull();
  });
  it("a tap opens the same Use this template as the computer, on the template itself (so the same picks make the same program); nothing on the phone builds or edits a template", () => {
    const phone = readFileSync(join(__dirname, "..", "components/coach/mobile/spot-templates.tsx"), "utf8");
    expect(phone).toContain('import { UseTemplatePanel } from "@/components/coach/desktop/use-template-panel";');
    expect(phone).toContain("<UseTemplatePanel programId={open.id} programName={open.name} groupId={open.groupId}");
    expect(phone).toContain("{NO_TEMPLATES_MESSAGE}");
    expect(phone).toContain("min-h-11");
    expect(phone).not.toMatch(/makeTemplate|Make a template\(|is_slot: true|\.update\(|\.insert\(/);
    const card = readFileSync(join(__dirname, "..", "components/coach/desktop/program-card-menu.tsx"), "utf8");
    expect(card).toContain("<UseTemplatePanel programId={programId} programName={programName} groupId={groupId}");
    const hub = readFileSync(join(__dirname, "..", "components/coach/mobile/coach-spot-hub.tsx"), "utf8");
    expect(hub).toContain("<SpotTemplates key={activeGroupId} groupId={activeGroupId} />");
  });
});
