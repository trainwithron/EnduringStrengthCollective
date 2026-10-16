import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NOTHING_FITS_MESSAGE, TEMPLATE_PICK_SYSTEM, buildTemplatePickUserText, implementOf, levelFromText, levelUsed, readTemplatePicks, type TemplateSlotCandidates } from "@/lib/ai-from-template";
import { scanConstraints } from "@/lib/constraint-scan";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const cand = (slot: string, n: number, name: string, extra: Partial<TemplateSlotCandidates["candidates"][number]> = {}) => ({ id: `${slot}.${n}`, name, rank: n, tier: "A", unilateral: false, implement: null, tags: [], ...extra });
const slots: TemplateSlotCandidates[] = [
  { id: "S1", rowId: "row1", label: "Week 1, Day 1 · Vertical Press", candidates: [cand("S1", 1, "Landmine Press", { implement: "landmine" }), cand("S1", 2, "Dumbbell Overhead Press", { implement: "dumbbell" })] },
  { id: "S2", rowId: "row2", label: "Week 1, Day 1 · Hinge", candidates: [cand("S2", 1, "Kettlebell Deadlift"), cand("S2", 2, "Barbell Romanian Deadlift")] },
  { id: "S3", rowId: "row3", label: "Week 1, Day 2 · Squat", candidates: [] },
];

describe("the AI only chooses among the candidates the code gives each slot", () => {
  it("a candidate of the slot is taken, with its reason", () => {
    const picks = readTemplatePicks({ picks: [{ slot: "S1", candidate: "S1.1", request: null, reason: "avoids full overhead range" }, { slot: "S2", candidate: "S2.2", request: null, reason: "fine" }, { slot: "S3", candidate: null, request: null, reason: "" }] }, slots, "limited overhead range");
    expect(picks[0]).toEqual({ rowId: "row1", exercise: "Landmine Press", reason: "avoids full overhead range", source: "ai" });
    expect(picks[1].exercise).toBe("Barbell Romanian Deadlift");
  });
  it("an id from another slot, an invented id and an invented name are all dropped: the slot uses the level default", () => {
    const picks = readTemplatePicks({ picks: [{ slot: "S1", candidate: "S2.1", reason: "x" }, { slot: "S2", candidate: "Zottman Curl", reason: "x" }] }, slots, "");
    expect(picks[0]).toMatchObject({ exercise: null, source: "default" });
    expect(picks[1]).toMatchObject({ exercise: null, source: "default" });
    // a slot the AI did not mention also keeps the default
    expect(picks[2]).toMatchObject({ exercise: null, source: "default" });
  });
  it("null means nothing is safe: the slot is left empty (the panel says nothing fits) rather than defaulted", () => {
    const picks = readTemplatePicks({ picks: [{ slot: "S1", candidate: null, request: null, reason: "every press loads the shoulder" }] }, slots, "shoulder injury");
    expect(picks[0]).toMatchObject({ exercise: "", source: "none" });
    expect(NOTHING_FITS_MESSAGE).toBe("Nothing on this ladder fits. Pick one or add an exercise.");
  });
  it("garbage from the model never throws and picks nothing", () => {
    for (const bad of [null, "x", 7, { picks: "no" }, { picks: [null, 3, { slot: 9 }] }]) {
      expect(readTemplatePicks(bad, slots, "").every((p) => p.source === "default")).toBe(true);
    }
  });
});

describe("an exercise the coach names fills the slot as theirs", () => {
  it("accepted only when the coach's own words contain it, and only once", () => {
    const text = "30-year-old mom of two. Include banded pallof press for the core.";
    const picks = readTemplatePicks({ picks: [{ slot: "S1", candidate: "S1.1", request: "Banded Pallof Press", reason: "" }, { slot: "S2", candidate: "S2.1", request: "Banded Pallof Press", reason: "" }] }, slots, text);
    expect(picks[0]).toMatchObject({ exercise: "Banded Pallof Press", source: "request" });
    expect(picks[1]).toMatchObject({ exercise: "Kettlebell Deadlift", source: "ai" });
  });
  it("an exercise the AI wrote that the coach never typed is ignored, and a leave-out is not a request", () => {
    expect(readTemplatePicks({ picks: [{ slot: "S1", candidate: "S1.2", request: "Turkish Get-Up", reason: "" }] }, slots, "limited overhead range")[0]).toMatchObject({ exercise: "Dumbbell Overhead Press", source: "ai" });
    expect(readTemplatePicks({ picks: [{ slot: "S1", candidate: "S1.2", request: "Dumbbell Overhead Press", reason: "" }] }, slots, "no dumbbell overhead press")[0].source).toBe("ai");
  });
});

describe("level", () => {
  it("the typed words win, then the one already chosen (the client stored level), then Intermediate", () => {
    expect(levelFromText("a complete beginner")).toBe("beginner");
    expect(levelFromText("experienced lifter")).toBe("advanced");
    expect(levelFromText("mom of two")).toBeNull();
    expect(levelUsed("advanced lifter", "beginner")).toBe("advanced");
    expect(levelUsed("mom of two", "beginner")).toBe("beginner");
    expect(levelUsed("mom of two", null)).toBe("intermediate");
  });
});

describe("what the model is told", () => {
  it("sees the typed words, the level, the injury and youth notes, and every slot with its candidates, implement and tags", () => {
    const text = buildTemplatePickUserText({ slots, level: "beginner", text: "limited overhead range of motion", injuryContext: "flagged shoulder", youthBlock: "This client is under 18.", retryNote: null });
    expect(text).toContain("Level: beginner.");
    expect(text).toContain("limited overhead range of motion");
    expect(text).toContain("flagged shoulder");
    expect(text).toContain("under 18");
    expect(text).toContain("S1.1: Landmine Press");
    expect(text).toContain("landmine");
    expect(text).toContain("(no candidates)");
    expect(TEMPLATE_PICK_SYSTEM).toContain("Never write an exercise name of your own");
    expect(implementOf("Dumbbell Overhead Press")).toBe("dumbbell");
    expect(implementOf("Landmine Press")).toBe("landmine");
  });
  it("a typed limit still reaches the worth-a-look check, so an AI pick that breaks it is flagged", () => {
    const flags = scanConstraints("no barbell squats, his back", [{ week: "Week 1", day: "Day 1", exerciseName: "Barbell Back Squat", sets: 3, reps: null, weight: null, rpe: null, rest: null, timeSeconds: null } as never]);
    expect(flags.length).toBeGreaterThan(0);
  });
});

describe("one call, charged once, never on a failure", () => {
  const route = read("app/api/ai/pick-template/route.ts");
  it("is a coach-only route with the safety reads, the program allowance check and a retry when cut off", () => {
    expect(route).toContain('membership?.role !== "coach"');
    expect(route).toContain('canRunAiAction(supabase, user.id, "program_generation")');
    expect(route).toContain("hasFlaggedMusculoskeletalConcern");
    expect(route).toContain("athleteAgeStatus");
    expect(route).toContain('feature: "program_template"');
    expect(route).toContain("TEMPLATE_PICK_TRUNCATED_NOTE");
  });
  it("spends the credit only after a usable answer has been read", () => {
    expect(route.indexOf("readTemplatePicks(")).toBeLessThan(route.indexOf("checkAndSpendCoachCredits(createServiceRoleClient()"));
  });
});

describe("the panel", () => {
  const panel = read("components/coach/desktop/use-template-panel.tsx");
  it("has the box, the button, the reasons and the nothing-fits line", () => {
    expect(panel).toContain("Who is it for? Anything to work around?");
    expect(panel).toContain("e.g. 30-year-old mom of two, limited overhead range of motion, no jumping");
    expect(panel).toContain('"Pick for me"');
    expect(panel).toContain("NOTHING_FITS_MESSAGE");
    expect(panel).toContain("YOUR_REQUEST_TAG");
  });
  it("Make stays disabled until every slot has an exercise (an empty pick counts as none)", () => {
    expect(panel).toContain("everySlotFilled(review, picks)");
  });
});
