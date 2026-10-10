import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { diffDraft, type DraftRow } from "@/lib/edit-diff";
import { askingLessThanBefore, detectSwapPatterns, patternKey, preferenceFor, suggestionText, type SignoffLite, type SwapEventLite } from "@/lib/edit-patterns";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");
const r = (name: string, order: number, over: Partial<DraftRow> = {}): DraftRow => ({ week: 1, day: 1, order, name, sets: 3, reps: "8", ...over });

describe("what the coach changed in the AI draft", () => {
  it("no changes, no events", () => {
    expect(diffDraft([r("Squat", 0), r("Bench", 1)], [r("Squat", 0), r("Bench", 1)])).toEqual([]);
  });
  it("one exercise replaced by another is a swap", () => {
    const e = diffDraft([r("Squat", 0), r("Walking Lunge", 1)], [r("Squat", 0), r("Reverse Lunge", 1)]);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ kind: "swap", from: "Walking Lunge", to: "Reverse Lunge" });
  });
  it("several swaps in one day pair by position", () => {
    const e = diffDraft([r("A", 0), r("B", 1), r("C", 2)], [r("X", 0), r("Y", 1), r("C", 2)]).filter((x) => x.kind === "swap");
    expect(e.map((x) => `${x.from}>${x.to}`).sort()).toEqual(["A>X", "B>Y"]);
  });
  it("an exercise removed or added on its own is not a swap", () => {
    expect(diffDraft([r("A", 0), r("B", 1)], [r("A", 0)]).map((x) => x.kind)).toEqual(["removed"]);
    expect(diffDraft([r("A", 0)], [r("A", 0), r("B", 1)]).map((x) => x.kind)).toEqual(["added"]);
  });
  it("sets or reps changed", () => {
    expect(diffDraft([r("A", 0)], [r("A", 0, { sets: 4 })]).map((x) => x.kind)).toEqual(["sets_reps"]);
    expect(diffDraft([r("A", 0)], [r("A", 0, { reps: "10" })]).map((x) => x.kind)).toEqual(["sets_reps"]);
  });
  it("order changed", () => {
    expect(diffDraft([r("A", 0), r("B", 1)], [r("B", 0), r("A", 1)]).map((x) => x.kind)).toEqual(["order"]);
  });
  it("names compare without caring about capitals", () => {
    expect(diffDraft([r("Back Squat", 0)], [r("back squat", 0)])).toEqual([]);
  });
});

describe("noticing a change the coach keeps making", () => {
  const signoffs = (n: number, has = true): SignoffLite[] => Array.from({ length: n }, (_, i) => ({ programId: `p${i}`, exercises: has ? ["Walking Lunge", "Squat"] : ["Squat"] }));
  const swaps = (n: number, from = "Walking Lunge", to = "Reverse Lunge"): SwapEventLite[] => Array.from({ length: n }, (_, i) => ({ programId: `p${i}`, from, to }));

  it("8 of 10 is a pattern", () => {
    const [p] = detectSwapPatterns(signoffs(10), swaps(8), new Set());
    expect(p).toMatchObject({ from: "Walking Lunge", to: "Reverse Lunge", count: 8, total: 10 });
    expect(suggestionText(p)).toBe("In 8 of your last 10 programs with Walking Lunge, you changed it to Reverse Lunge. Use Reverse Lunge instead from now on?");
  });
  it("fewer than 5 times is not enough, however consistent", () => {
    expect(detectSwapPatterns(signoffs(4), swaps(4), new Set())).toEqual([]);
  });
  it("5 times but in fewer than 70% of the programs that had it is not enough", () => {
    expect(detectSwapPatterns(signoffs(10), swaps(5), new Set())).toEqual([]);
    expect(detectSwapPatterns(signoffs(7), swaps(5), new Set())).toHaveLength(1);
  });
  it("only the last 10 programs count", () => {
    expect(detectSwapPatterns(signoffs(12), swaps(12).map((e, i) => ({ ...e, programId: `p${i}` })).filter((e) => Number(e.programId.slice(1)) >= 10), new Set())).toEqual([]);
  });
  it("a pattern already asked about (Yes, No, undone or just shown) is never asked again", () => {
    expect(detectSwapPatterns(signoffs(10), swaps(9), new Set([patternKey("walking lunge", "REVERSE LUNGE")]))).toEqual([]);
  });
  it("the strongest comes first", () => {
    const ev = [...swaps(7, "A", "B"), ...swaps(9, "C", "D")];
    const s = signoffs(10).map((x) => ({ ...x, exercises: ["A", "C"] }));
    expect(detectSwapPatterns(s, ev, new Set()).map((p) => p.from)).toEqual(["C", "A"]);
  });
  it("a Yes writes one plain line into the standing preferences", () => {
    expect(preferenceFor({ from: "Walking Lunge", to: "Reverse Lunge" })).toEqual({ condition: "writing any program", preference: "Use Reverse Lunge instead of Walking Lunge." });
  });
  it("asking less is only claimed once there are six programs and the recent ones have fewer questions", () => {
    expect(askingLessThanBefore([1, 1, 1])).toBe(false);
    expect(askingLessThanBefore([2, 2, 1, 1, 0, 0])).toBe(true);
    expect(askingLessThanBefore([0, 0, 1, 1, 2, 2])).toBe(false);
  });
});

describe("how it is wired", () => {
  const signoff = read("app/api/ai/sign-off/route.ts");
  const rules = read("app/api/learned-rules/[ruleId]/route.ts");
  const reason = read("app/api/ai/learn-reason/route.ts");
  const sql = read("supabase/migrations/0325_ai_builder_learning.sql");

  it("signing off makes the program active in one update, and learning can never block it", () => {
    expect(signoff).toContain('update({ ai_draft: false, is_active: true })');
    expect(signoff).toContain("// Learning is quiet and never blocks the sign-off.");
    expect(signoff).toContain("if (!program.ai_draft) return NextResponse.json({ ok: true, suggestion: null });");
  });
  it("at most one suggestion, and never when questions are off", () => {
    expect(signoff).toContain("const [pattern] = detectSwapPatterns(");
    expect(signoff).toContain("questions_enabled !== false");
    expect(signoff.match(/from\("coach_learned_rules"\)\s*\.insert/g)?.length).toBe(1);
  });
  it("a rule only applies after Yes, No is final, Undo removes the line", () => {
    expect(rules).toContain('case "yes"');
    expect(rules).toContain('.from("coach_program_preferences")\n        .insert(');
    expect(rules).toContain('status: "declined"');
    expect(rules).toContain('.from("coach_program_preferences").delete().eq("id", rule.preference_id)');
    expect(rules).toContain('eq("coach_id", user.id)');
  });
  it("the reason becomes a plain sentence from only what the coach said, counted in the AI allowance", () => {
    expect(reason).toContain("Never add a reason, a body part, a condition or a number they did not say");
    expect(reason).toContain('feature: "program_chat"');
    expect(reason).toContain('aiInputTooLong("program_chat", reason)');
  });
  it("everything is private to the coach and a safety rule cannot be learned away", () => {
    for (const t of ["coach_program_signoffs", "coach_edit_events", "coach_learned_rules", "coach_learning_settings"]) {
      expect(sql).toContain(`create policy "${t}_own" on public.${t}`);
    }
    expect(sql).toContain("(select auth.uid())");
    expect(read("app/api/ai/generate-program/route.ts")).toContain("NEVER overrides a safety rule in this prompt");
  });
  it("the wizard keeps what the AI wrote on the draft", () => {
    expect(read("components/coach/desktop/import-wizard.tsx")).toContain('update({ ai_snapshot: aiSnapshot })');
  });
  it("the suggestion is one quiet card on the program just signed off; the list is on the Programs page", () => {
    expect(read("app/(coach)/groups/[groupId]/programs/[programId]/page.tsx")).toContain("<LearnedSuggestionCard");
    expect(read("app/(coach)/programs/page.tsx")).toContain("<LearnedSection");
    const list = read("components/coach/learned-list.tsx");
    expect(list).toContain("What I&apos;ve learned about how you coach");
    expect(list).toContain("Ask me about changes I make");
    const card = read("components/coach/learned-suggestion-card.tsx");
    expect(card).toContain("Tell me why, so I can build it your way next time. You can skip this.");
    expect(card).toContain("<MicButton");
  });
});
