import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Oct 26: every screen works from the coach's OWN movement patterns; the starter set (lib/starter-ladders.ts) is copied into them by "Add the starter ladders". Ron had not done that yet, so + Slot was
// empty and Make a template would make no slots. Now a coach with no ladders gets the starter ladders as part of the click (+ Slot, Make a template); nothing is written by opening a page.
const added = vi.fn();
vi.mock("@/lib/starter-ladders-add", () => ({ addStarterLadders: (...args: unknown[]) => added(...args) }));
const { loadCoachLadders, toLadderEntries } = await import("./coach-ladders");
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

const rung = (exercise: string, pattern: string, tier: string | null, unilateral = false) => ({ exercise_name: exercise, tier, is_unilateral: unilateral, movement_pattern_id: `p-${pattern}`, movement_patterns: { name: pattern } });
function db(reads: ({ data: unknown[] } | { error: true })[]) {
  const calls: string[] = [];
  return {
    calls,
    client: {
      from: (table: string) => ({
        select: () => ({
          eq: async (col: string, val: string) => {
            calls.push(`${table}.${col}=${val}`);
            const next = reads.shift() ?? { data: [] };
            return "error" in next ? { data: null, error: { message: "x" } } : { data: next.data, error: null };
          },
        }),
      }),
    },
  };
}

beforeEach(() => added.mockReset());

describe("the ladders are the coach's own", () => {
  it("each rung is read with its pattern, class and side", () => {
    expect(toLadderEntries([rung("Bulgarian Split Squat", "Squat", "A", true)])).toEqual([{ exerciseName: "Bulgarian Split Squat", patternId: "p-Squat", patternName: "Squat", tier: "A", unilateral: true }]);
  });
  it("a coach with ladders: theirs are used, nothing is added, only their own are read", async () => {
    const d = db([{ data: [rung("Goblet Squat", "Squat", "B")] }]);
    const r = await loadCoachLadders(d.client as never, "ron");
    expect(r).toEqual({ ladders: [expect.objectContaining({ exerciseName: "Goblet Squat" })], addedStarters: false });
    expect(added).not.toHaveBeenCalled();
    expect(d.calls).toEqual(["movement_pattern_exercises.movement_patterns.created_by=ron"]);
  });
  it("a coach with none: the starter ladders are added for them first, then read (and the summary will say so)", async () => {
    added.mockResolvedValue({ ok: true, line: "Added 14 ladders.", patterns: [] });
    const d = db([{ data: [] }, { data: [rung("Goblet Squat", "Squat", "B"), rung("Romanian Deadlift", "Hinge", "A")] }]);
    const r = await loadCoachLadders(d.client as never, "ron");
    expect(added).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ addedStarters: true });
    expect("ladders" in r && r.ladders.length).toBe(2);
  });
  it("a failed read or a failed add is said, never read as 'no ladders'", async () => {
    expect(await loadCoachLadders(db([{ error: true }]).client as never, "ron")).toEqual({ error: true });
    added.mockResolvedValue({ ok: false });
    expect(await loadCoachLadders(db([{ data: [] }]).client as never, "ron")).toEqual({ error: true });
  });
  it("nothing reads another account's patterns (the seed coach's rows are test data)", () => {
    for (const f of ["lib/coach-ladders.ts", "lib/make-template.ts", "lib/starter-ladders-add.ts", "lib/program-builder-data.ts"]) expect(read(f), f).not.toContain("11111111-1111-1111-1111-111111111111");
  });
});

describe("one code path for the starter ladders, run only on a click", () => {
  it("the Exercise Library button, + Slot and Make a template all use addStarterLadders", () => {
    expect(read("components/coach/add-starter-ladders-button.tsx")).toContain("await addStarterLadders(supabase, userId)");
    expect(read("lib/coach-ladders.ts")).toContain("const added = await addStarterLadders(supabase, coachId);");
    const day = read("components/coach/desktop/day-card.tsx");
    expect(day).toContain("await addStarterLadders(supabase, userData.user.id)");
    expect(day).toContain("onClick={() => void openSlotForm()}");
  });
  it("+ Slot adds them only on the click, and only when the coach has no patterns; then shows them", () => {
    const day = read("components/coach/desktop/day-card.tsx");
    const fn = day.slice(day.indexOf("async function openSlotForm()"), day.indexOf("async function openSlotForm()") + 900);
    expect(fn).toContain("if (slotPatterns.length > 0) {");
    expect(fn).toContain("setSlotPatterns(result.patterns);");
    expect(day.match(/addStarterLadders\(/g)).toHaveLength(1);
    expect(day).toContain("patterns={slotPatterns}");
  });
  it("Make a template tells the coach when it added them", () => {
    const mt = read("lib/make-template.ts");
    expect(mt).toContain('const added = ladderRead.addedStarters ? "Your starter movement ladders were added. " : "";');
    expect(mt).toContain("summary: `${added}${templateSummary(plan)}`");
  });
});
