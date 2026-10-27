import { describe, it, expect, vi, beforeEach } from "vitest";

// Make a template on a program none of whose exercises is on a movement ladder: before, it made a 0-slot "template" (a switched-off copy that showed under Programs). Now nothing is made.
const duplicate = vi.fn();
const ladders = vi.fn();
vi.mock("@/lib/coach-groups", () => ({
  getCoachedGroups: async () => [{ id: "team", kind: "team", orgId: "org", name: "Team", archived: false }],
  groupsInOrgOf: (g: unknown[]) => g,
  pickAnchorGroup: (g: { id: string }[]) => g[0],
}));
vi.mock("@/lib/coach-ladders", () => ({ loadCoachLadders: (...a: unknown[]) => ladders(...a) }));
vi.mock("@/lib/program-duplication", () => ({
  duplicateProgram: (...a: unknown[]) => duplicate(...a),
  importRefusal: async () => null,
  isImportRefusal: () => false,
}));
const { makeTemplate, NOTHING_TO_SLOT } = await import("./make-template");

const rows = (names: string[]) => names.map((n, i) => ({ id: `e${i}`, exercise_name: n, is_slot: false }));
function db(exercises: { id: string; exercise_name: string; is_slot: boolean }[]) {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = async () => ({ data: exercises, error: null });
  chain.update = () => ({ eq: async () => ({ error: null }) });
  chain.delete = () => ({ eq: async () => ({ error: null }) });
  return { from: () => chain };
}

beforeEach(() => {
  duplicate.mockReset();
  ladders.mockReset();
});

describe("Make a template with nothing on a ladder", () => {
  it("makes nothing and says why, in Commander's words", async () => {
    ladders.mockResolvedValue({ ladders: [{ exerciseName: "Goblet Squat", patternId: "sq", patternName: "Squat", tier: "B", unilateral: false }], addedStarters: false });
    const r = await makeTemplate(db(rows(["Bench Press", "Plank"])) as never, { programId: "p", programName: "Big Sauce", groupId: "team", coachId: "ron" });
    expect(r).toEqual({ error: NOTHING_TO_SLOT });
    expect(NOTHING_TO_SLOT).toBe("None of these exercises are on a movement ladder yet, so there is nothing to turn into slots. Add them to a ladder in the Exercise Library, or add a slot by hand.");
    expect(duplicate).not.toHaveBeenCalled();
  });
  it("when the starter ladders were just added for the coach, it says that first", async () => {
    ladders.mockResolvedValue({ ladders: [], addedStarters: true });
    const r = await makeTemplate(db(rows(["Bench Press"])) as never, { programId: "p", programName: "Big Sauce", groupId: "team", coachId: "ron" });
    expect(r).toEqual({ error: `Your starter movement ladders were added. ${NOTHING_TO_SLOT}` });
    expect(duplicate).not.toHaveBeenCalled();
  });
  it("one exercise on a ladder: the template is made as before", async () => {
    ladders.mockResolvedValue({ ladders: [{ exerciseName: "Goblet Squat", patternId: "sq", patternName: "Squat", tier: "B", unilateral: false }], addedStarters: false });
    duplicate.mockResolvedValue({ programId: "t1" });
    const r = await makeTemplate(db(rows(["Goblet Squat", "Plank"])) as never, { programId: "p", programName: "Big Sauce", groupId: "team", coachId: "ron" });
    expect(r).toMatchObject({ programId: "t1", groupId: "team" });
    expect("summary" in r && r.summary).toBe("1 of 2 exercises became a slot; Plank stayed as it is (not on a ladder yet).");
  });
});
