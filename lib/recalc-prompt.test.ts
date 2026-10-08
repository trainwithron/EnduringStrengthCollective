import { describe, expect, it } from "vitest";
import { answerRow, moreVariety, recalcPromptFor, RECALC_PROMPT_DAYS } from "@/lib/recalc-prompt";

const row = (effective_from: string, calories: number | null) => ({ effective_from, calories, protein_g: 150, carbs_g: 200, fat_g: 60 });
const TODAY = "2026-10-08";

describe("recalcPromptFor", () => {
  it("shows for a new, different target that took effect recently and is unanswered", () => {
    const p = recalcPromptFor([row("2026-09-01", 2200), row("2026-10-06", 2000)], [], TODAY);
    expect(p).toEqual({ effectiveFrom: "2026-10-06", calories: 2000, previousCalories: 2200 });
  });
  it("shows on the day it takes effect and for exactly the window after it", () => {
    expect(recalcPromptFor([row("2026-09-01", 2200), row(TODAY, 2000)], [], TODAY)).not.toBeNull();
    expect(recalcPromptFor([row("2026-09-01", 2200), row("2026-09-24", 2000)], [], TODAY)).not.toBeNull();
    expect(RECALC_PROMPT_DAYS).toBe(14);
    expect(recalcPromptFor([row("2026-09-01", 2200), row("2026-09-23", 2000)], [], TODAY)).toBeNull();
  });
  it("a client's very first target asks nothing", () => {
    expect(recalcPromptFor([row("2026-10-06", 2000)], [], TODAY)).toBeNull();
    expect(recalcPromptFor([row("2026-09-01", null), row("2026-10-06", 2000)], [], TODAY)).toBeNull();
  });
  it("the same number saved again asks nothing", () => {
    expect(recalcPromptFor([row("2026-09-01", 2000), row("2026-10-06", 2000)], [], TODAY)).toBeNull();
  });
  it("compares against the last target that HAD calories, skipping a removal", () => {
    const p = recalcPromptFor([row("2026-09-01", 2200), row("2026-09-20", null), row("2026-10-06", 2000)], [], TODAY);
    expect(p?.previousCalories).toBe(2200);
  });
  it("a target that takes effect LATER is not in force yet: the one in force today decides", () => {
    expect(recalcPromptFor([row("2026-09-01", 2200), row("2026-10-12", 2000)], [], TODAY)).toBeNull();
    const p = recalcPromptFor([row("2026-09-01", 2400), row("2026-10-05", 2200), row("2026-10-12", 2000)], [], TODAY);
    expect(p).toEqual({ effectiveFrom: "2026-10-05", calories: 2200, previousCalories: 2400 });
  });
  it("answered for that date means no more asking, but the next change asks again", () => {
    const history = [row("2026-09-01", 2200), row("2026-10-06", 2000)];
    expect(recalcPromptFor(history, ["2026-10-06"], TODAY)).toBeNull();
    expect(recalcPromptFor([...history, row("2026-10-08", 1900)], ["2026-10-06"], TODAY)?.effectiveFrom).toBe("2026-10-08");
  });
  it("a removal as the current target, or no history, asks nothing", () => {
    expect(recalcPromptFor([row("2026-09-01", 2200), row("2026-10-06", null)], [], TODAY)).toBeNull();
    expect(recalcPromptFor([], [], TODAY)).toBeNull();
    expect(recalcPromptFor(null, [], TODAY)).toBeNull();
  });
});

describe("answerRow", () => {
  it("an unhappy answer puts the words in 'what to change'", () => {
    expect(answerRow({ happy: false, text: "  too   much chicken ", boring: false })).toEqual({ happy: false, change_text: "too much chicken", requests_text: "", boring: false });
  });
  it("a happy answer keeps any extra words as a request and the boring flag", () => {
    expect(answerRow({ happy: true, text: "more fish please", boring: true })).toEqual({ happy: true, change_text: "", requests_text: "more fish please", boring: true });
  });
  it("is cut at the database limit of 500 characters", () => {
    expect(answerRow({ happy: false, text: "x".repeat(900), boring: false }).change_text).toHaveLength(500);
  });
});

describe("moreVariety", () => {
  it("moves one step up and stops at the top", () => {
    expect(moreVariety("same_most_days")).toBe("few_favorites");
    expect(moreVariety("few_favorites")).toBe("mix_it_up");
    expect(moreVariety("mix_it_up")).toBe("mix_it_up");
    expect(moreVariety("something_else")).toBe("something_else");
  });
});
