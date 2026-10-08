import { describe, expect, it } from "vitest";
import { buildPhaseReview, pathAssessment, type PhaseReview, type ReviewInput } from "@/lib/phase-review";
import { checkInDraft, continueDraft, draftsFor, extendDraft, factsFromReview, lowAdherenceDraft, moveDraft, type DraftFacts } from "@/lib/phase-review-drafts";
import { resultLines, stanceLine, verdictLine } from "@/lib/phase-review-view";

const TODAY = "2026-10-08";
function review(over: Partial<ReviewInput> & { latestAvgW?: number } = {}): PhaseReview {
  const a = 200;
  const b = over.latestAvgW ?? 198.4;
  return buildPhaseReview({
    phase: "fat_loss",
    startedOn: "2026-09-25",
    lastReviewedOn: null,
    todayKey: TODAY,
    weights: [
      { loggedDate: "2026-09-26", weight: a },
      { loggedDate: "2026-09-30", weight: a },
      { loggedDate: "2026-10-03", weight: b },
      { loggedDate: "2026-10-07", weight: b },
    ],
    daysLogged: 12,
    calories: 2000,
    floorCalories: 1500,
    ...over,
  });
}
const facts = (r: PhaseReview): DraftFacts => factsFromReview(r, "Sam", "lb");

const BANNED = /hurry|last chance|only today|limited|guarantee|promise|disappointed|fail|behind|lazy|cheat|deficien|starvation|damaged|broken|\$|price|\bpay\b|payment|\bfees?\b|hormone|thyroid|diagnos|cure|should have|must |have to /i;
const numbers = (t: string) => (t.match(/\d+(?:\.\d+)?/g) ?? []).sort();

describe("the drafted messages", () => {
  const cases: [string, string][] = (() => {
    const r = review();
    const f = facts(r);
    const low = review({ daysLogged: 6 });
    const under = review({ calories: 1400 });
    return [
      ["continue", continueDraft(f, r.verdict)],
      ["continue, too fast", continueDraft(facts(review({ latestAvgW: 195 })), "too_fast")],
      ["continue, no change", continueDraft(facts(review({ latestAvgW: 199.9 })), "no_change")],
      ["continue, under the soft floor", continueDraft(facts(under), under.verdict)],
      ["move", moveDraft(f, "reverse_diet")],
      ["move to maintenance", moveDraft(f, "maintenance")],
      ["check-in", checkInDraft(f)],
      ["low adherence", lowAdherenceDraft(facts(low))],
      ["extend", extendDraft(f)],
    ];
  })();
  it.each(cases)("%s: names the client, stays short, and has no pressure, guilt, money, promises or medical claims", (_n, text) => {
    expect(text.startsWith("Hi Sam,")).toBe(true);
    expect(text.length).toBeLessThanOrEqual(600);
    expect(text).not.toMatch(BANNED);
  });
  it("uses only numbers that are on the card", () => {
    const r = review();
    const f = facts(r);
    const onCard = new Set(numbers(`${resultLines(r, "lb").join(" ")} ${verdictLine(r, "Sam")}`));
    for (const text of [continueDraft(f, r.verdict), moveDraft(f, "reverse_diet"), checkInDraft(f), extendDraft(f)]) {
      for (const n of numbers(text)) expect(onCard.has(n) || n === String(Number(n)) && onCard.has(n), `${n} in: ${text}`).toBe(true);
    }
  });
  it("moves with 'you have shown' wording only when the numbers support it; otherwise it is a plain check-in that does not pitch the next phase", () => {
    const good = review();
    const supports = pathAssessment({ review: good, target: "reverse_diet", bodyFatPct: 18, sex: "male" });
    expect(supports.stance).toBe("supports");
    const d = draftsFor(good, facts(good), supports.stance, "reverse_diet");
    expect(d.move).toContain("reverse diet");
    expect(d.move).toContain("starting your new training block");
    const lowR = review({ daysLogged: 6 });
    const lowDrafts = draftsFor(lowR, facts(lowR), "does_not_support", "reverse_diet");
    expect(lowDrafts.move).not.toMatch(/reverse diet|metabolism/i);
    expect(lowDrafts.move).toContain("logged");
    const noSupport = pathAssessment({ review: good, target: "reverse_diet", bodyFatPct: 30, sex: "male" });
    expect(noSupport.stance).toBe("does_not_support");
    expect(draftsFor(good, facts(good), noSupport.stance, "reverse_diet").move).not.toMatch(/reverse diet/i);
  });
  it("has no move draft when there is nothing to move to", () => {
    const r = review();
    expect(draftsFor(r, facts(r), "supports", null).move).toBeNull();
    expect(draftsFor(r, facts(r), "supports", "fat_loss").move).toBeNull();
  });
  it("a low-adherence review gets the gentle logging question, never the weight result", () => {
    const r = review({ daysLogged: 6 });
    const d = draftsFor(r, facts(r), null, null);
    expect(d.continue).toContain("cannot read much into the scale");
    expect(d.continue).not.toMatch(/weight is/i);
  });
  it("when calories are under the soft floor it says this is a short, watched stretch, and never encourages going lower", () => {
    const r = review({ calories: 1400 });
    const text = continueDraft(facts(r), r.verdict);
    expect(text).toContain("short, watched stretch");
    expect(text).toContain("will not go lower");
  });
  it("a flat result says so without inventing a direction", () => {
    const r = review({ latestAvgW: 200 });
    expect(extendDraft(facts(r))).toContain("stayed about the same");
  });
});

describe("the words on the card", () => {
  it("states the result in plain terms, in the client's unit", () => {
    const lines = resultLines(review(), "lb");
    expect(lines[1]).toContain("200 lb to 198.4 lb (down 1.6 lb), about 0.8 percent of body weight a week");
    expect(lines.join(" ")).toContain("Food logged on 12 of 14 days");
    expect(resultLines(review(), "kg")[1]).toContain("kg");
  });
  it("a thin result says there is no trend yet, and low adherence says the result does not say much", () => {
    expect(resultLines(review({ weights: [] }), "lb")[1]).toBe("Weight: no trend to show yet.");
    expect(verdictLine(review({ daysLogged: 6 }), "Sam")).toContain("does not say much yet");
    expect(verdictLine(review({ weights: [] }), "Sam")).toContain("Too few weigh-ins");
  });
  it("says whether the numbers support the planned step, with the reasons kept separate", () => {
    const good = review();
    expect(stanceLine(pathAssessment({ review: good, target: "reverse_diet", bodyFatPct: 18, sex: "male" }), "fat_loss", "reverse_diet")).toBe("The numbers support moving to reverse diet.");
    expect(stanceLine(pathAssessment({ review: good, target: "reverse_diet", bodyFatPct: 30, sex: "male" }), "fat_loss", "reverse_diet")).toBe("The numbers do not support moving to reverse diet yet.");
    expect(stanceLine(pathAssessment({ review: good, target: "reverse_diet", bodyFatPct: null, sex: "male" }), "fat_loss", "reverse_diet")).toContain("do not say clearly");
    expect(stanceLine(pathAssessment({ review: good, target: "fat_loss", bodyFatPct: 18, sex: "male" }), "fat_loss", "fat_loss")).toBe("The numbers support continuing fat loss.");
  });
});
