import { describe, expect, it } from "vitest";
import { buildPhaseReview, pathAssessment, reviewWindowStart, speedVerdict, type PhaseReview, type ReviewInput } from "@/lib/phase-review";

const TODAY = "2026-10-08";
// Started 14 days ago (Sep 25 to Oct 8 is exactly 14 days with both ends counted), so the first week is Sep 25 to Oct 1 and the latest week is Oct 2 to Oct 8.
const START_14 = "2026-09-25";

function review(over: Partial<ReviewInput> & { startAvgW?: number; latestAvgW?: number } = {}): PhaseReview {
  const a = over.startAvgW ?? 200;
  const b = over.latestAvgW ?? 198.4;
  const input: ReviewInput = {
    phase: "fat_loss",
    startedOn: START_14,
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
  };
  return buildPhaseReview(input);
}

describe("the window and the numbers", () => {
  it("starts when the phase began or was last reviewed, never more than 28 days back", () => {
    expect(reviewWindowStart("2026-10-01", null, TODAY)).toBe("2026-10-01");
    expect(reviewWindowStart("2026-08-01", null, TODAY)).toBe("2026-09-11");
    expect(reviewWindowStart("2026-08-01", "2026-09-20", TODAY)).toBe("2026-09-20");
    expect(reviewWindowStart("2026-08-01", "2026-08-15", TODAY)).toBe("2026-09-11");
  });
  it("compares the average of the first 7 days with the average of the latest 7, and reads the speed per week", () => {
    const r = review({ startAvgW: 200, latestAvgW: 198.4 });
    expect(r.elapsedDays).toBe(14);
    expect(r.startAvg).toBe(200);
    expect(r.latestAvg).toBe(198.4);
    expect(r.changeLbs).toBe(-1.6);
    expect(r.weeklyRatePct).toBe(-0.8);
    expect(r.verdict).toBe("on_track");
    expect(r.weeksInPhase).toBe(2);
  });
  it("a longer window spreads the same change over more weeks", () => {
    const r = review({
      startedOn: "2026-09-11",
      weights: [
        { loggedDate: "2026-09-12", weight: 200 },
        { loggedDate: "2026-09-16", weight: 200 },
        { loggedDate: "2026-10-03", weight: 196 },
        { loggedDate: "2026-10-07", weight: 196 },
      ],
      daysLogged: 24,
    });
    expect(r.elapsedDays).toBe(28);
    expect(r.weeklyRatePct).toBe(-0.67); // -2% over 3 weeks
  });
});

describe("the verdict at its boundaries (fat loss)", () => {
  it("-1.5 percent a week is still fine; just past it is too fast", () => {
    expect(review({ latestAvgW: 197 }).weeklyRatePct).toBe(-1.5);
    expect(review({ latestAvgW: 197 }).verdict).toBe("on_track");
    expect(review({ latestAvgW: 196.9 }).verdict).toBe("too_fast");
  });
  it("-0.3 percent a week is the stall line: at it, still on track; just under it, no change", () => {
    expect(review({ latestAvgW: 199.4 }).weeklyRatePct).toBe(-0.3);
    expect(review({ latestAvgW: 199.4 }).verdict).toBe("on_track");
    expect(review({ latestAvgW: 199.5 }).verdict).toBe("no_change");
    expect(review({ latestAvgW: 200.6 }).verdict).toBe("no_change");
    expect(review({ latestAvgW: 200.7 }).verdict).toBe("wrong_way");
  });
  it("logging on 5 of every 7 days is enough; 4 of 7 is not", () => {
    expect(review({ daysLogged: 10 }).adherenceOk).toBe(true);
    expect(review({ daysLogged: 10 }).verdict).toBe("on_track");
    expect(review({ daysLogged: 9 }).adherenceOk).toBe(false);
    expect(review({ daysLogged: 9 }).verdict).toBe("low_adherence");
  });
  it("low adherence is said before any weight verdict, even a good-looking one", () => {
    const r = review({ daysLogged: 6, latestAvgW: 198.4 });
    expect(r.verdict).toBe("low_adherence");
    expect(r.weeklyRatePct).toBeNull();
  });
  it("under two weeks is too early; one weigh-in at an end is not enough", () => {
    const early = review({ startedOn: "2026-09-26", daysLogged: 11 });
    expect(early.elapsedDays).toBe(13);
    expect(early.verdict).toBe("not_enough_data");
    expect(early.thin).toBe("too_early");
    const one = review({ weights: [{ loggedDate: "2026-09-26", weight: 200 }, { loggedDate: "2026-10-03", weight: 198 }, { loggedDate: "2026-10-07", weight: 198 }] });
    expect(one.verdict).toBe("not_enough_data");
    expect(one.thin).toBe("few_weighins");
    expect(review({ weights: [] }).thin).toBe("few_weighins");
  });
  it("calories under the soft floor are reported, never blocked", () => {
    expect(review({ calories: 1400 }).underFloor).toBe(true);
    expect(review({ calories: 1500 }).underFloor).toBe(false);
    expect(review({ calories: null }).underFloor).toBe(false);
    expect(review({ calories: 1400 }).verdict).toBe("on_track");
  });
});

describe("other phases use their own lines", () => {
  it("muscle building: slow gain is right, too fast is flagged, flat or falling is not", () => {
    expect(speedVerdict("hypertrophy", 0.3)).toBe("on_track");
    expect(speedVerdict("hypertrophy", 0.6)).toBe("on_track");
    expect(speedVerdict("hypertrophy", 0.61)).toBe("too_fast");
    expect(speedVerdict("hypertrophy", 0.1)).toBe("on_track");
    expect(speedVerdict("hypertrophy", 0.09)).toBe("no_change");
    expect(speedVerdict("hypertrophy", -0.31)).toBe("wrong_way");
  });
  it("reverse diet: flat or down counts, up more than half a percent a week does not", () => {
    expect(speedVerdict("reverse_diet", 0.5)).toBe("on_track");
    expect(speedVerdict("reverse_diet", -0.4)).toBe("on_track");
    expect(speedVerdict("reverse_diet", 0.51)).toBe("wrong_way");
  });
  it("maintenance: within half a percent either way", () => {
    expect(speedVerdict("maintenance", 0.5)).toBe("on_track");
    expect(speedVerdict("maintenance", -0.5)).toBe("on_track");
    expect(speedVerdict("maintenance", -0.51)).toBe("wrong_way");
  });
});

describe("the stance on the planned next phase (decided by the numbers)", () => {
  const assess = (r: PhaseReview, target: Parameters<typeof pathAssessment>[0]["target"], bodyFatPct: number | null = null, sex: "male" | "female" | null = "male") => pathAssessment({ review: r, target, bodyFatPct, sex });
  it("a reverse diet is supported only by a good result AND body fat under the line", () => {
    expect(assess(review(), "reverse_diet", 18).stance).toBe("supports");
    expect(assess(review(), "reverse_diet", 24.9).stance).toBe("supports");
    expect(assess(review(), "reverse_diet", 25).stance).toBe("does_not_support");
    expect(assess(review(), "reverse_diet", 31.9, "female").stance).toBe("supports");
    expect(assess(review(), "reverse_diet", 32, "female").stance).toBe("does_not_support");
  });
  it("a reverse diet is NOT supported for low adherence, no change or the wrong way, whatever the body fat", () => {
    expect(assess(review({ daysLogged: 6 }), "reverse_diet", 15).stance).toBe("does_not_support");
    expect(assess(review({ latestAvgW: 199.9 }), "reverse_diet", 15).stance).toBe("does_not_support");
    expect(assess(review({ latestAvgW: 202 }), "reverse_diet", 15).stance).toBe("does_not_support");
  });
  it("it is unclear when the data is thin, the pace is too fast, or body fat or sex is missing", () => {
    expect(assess(review({ weights: [] }), "reverse_diet", 15).stance).toBe("unclear");
    expect(assess(review({ latestAvgW: 195 }), "reverse_diet", 15).stance).toBe("unclear");
    const noBf = assess(review(), "reverse_diet", null);
    expect(noBf.stance).toBe("unclear");
    expect(noBf.factors.join(" ")).toMatch(/Body fat is not on file/);
    const noSex = assess(review(), "reverse_diet", 20, null);
    expect(noSex.stance).toBe("unclear");
    expect(noSex.factors.join(" ")).toMatch(/Sex is not on file/);
  });
  it("it never claims support without saying why, and says why not", () => {
    const no = assess(review({ daysLogged: 6 }), "reverse_diet", 15);
    expect(no.factors.join(" ")).toMatch(/too few days/);
    const high = assess(review(), "reverse_diet", 30);
    expect(high.factors.join(" ")).toMatch(/longer deficit/);
  });
  it("continuing a deficit: supported while it works or when body fat is above the line, not when it is too fast or the floor applies without results", () => {
    expect(assess(review(), "fat_loss", 20).stance).toBe("supports");
    expect(assess(review({ latestAvgW: 195 }), "fat_loss", 20).stance).toBe("does_not_support");
    // body fat above the line never turns a result that is not working into a green light
    const flat = assess(review({ latestAvgW: 199.9 }), "fat_loss", 30);
    expect(flat.stance).toBe("unclear");
    expect(flat.factors.join(" ")).toMatch(/weight has not followed/);
    expect(assess(review({ latestAvgW: 202 }), "fat_loss", 30).stance).toBe("unclear");
    expect(assess(review({ latestAvgW: 199.9 }), "fat_loss", 15).stance).toBe("unclear");
    expect(assess(review({ latestAvgW: 199.9, calories: 1400 }), "fat_loss", 15).stance).toBe("does_not_support");
    expect(assess(review({ daysLogged: 6 }), "fat_loss", 30).stance).toBe("unclear");
  });
  it("moving to maintenance or muscle building: supported by a good result, not by a poor or thin one", () => {
    expect(assess(review(), "maintenance").stance).toBe("supports");
    expect(assess(review(), "hypertrophy").stance).toBe("supports");
    expect(assess(review({ daysLogged: 6 }), "maintenance").stance).toBe("does_not_support");
    expect(assess(review({ weights: [] }), "maintenance").stance).toBe("unclear");
  });
});
