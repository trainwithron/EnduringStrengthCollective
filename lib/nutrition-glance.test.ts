import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildFoodWeek, type FoodEntryRow } from "./food-week";
import { cellText, checkinCountdown, dayNutrientBars, glanceDays, weekAverage, weightSeries, type DayTargetFull } from "./nutrition-glance";
import type { LoggedEntry } from "./nutrient-day";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

// Ron, Oct 21: "revamp that whole page, and maximize it, based on ... Cronometer" (with his MacroFactor and Cronometer screenshots).
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const TODAY = "2026-10-21"; // a Wednesday
const row = (log_date: string, meal_slot: string, calories: number, p: number, c: number, f: number, status = "ate_it", description = "Food"): FoodEntryRow => ({ log_date, meal_slot, status, description, calories, protein_g: p, carbs_g: c, fat_g: f });
const target: DayTargetFull = { calories: 2000, proteinG: 150, carbsG: 200, fatG: 67 };

function week(entries: FoodEntryRow[]) {
  return buildFoodWeek({ entries, todayKey: TODAY, targetFor: () => ({ calories: 2000, proteinG: 150 }) });
}

describe("the 7-day grid", () => {
  const days = glanceDays(
    week([row(TODAY, "breakfast", 500, 40, 50, 15, "ate_it", "Oats"), row(TODAY, "dinner", 1700, 110, 150, 60, "ate_it", "Steak"), row(TODAY, "lunch", 300, 0, 0, 0, "skipped", "Salad"), row("2026-10-19", "lunch", 1000, 75, 100, 33)]),
    () => target
  );
  it("a column per day, oldest first, ending today, with the weekday letter", () => {
    expect(days.map((d) => d.letter)).toEqual(["T", "F", "S", "S", "M", "T", "W"]);
    expect(days[6].isToday).toBe(true);
  });
  it("each of calories, protein, carbs and fat against that day's own target, filled past 100 when over", () => {
    const t = days[6].cells;
    expect(t.calories).toEqual({ eaten: 2200, target: 2000, pct: 110 });
    expect(t.protein).toEqual({ eaten: 150, target: 150, pct: 100 });
    expect(t.carbs.pct).toBe(100);
    expect(t.fat.pct).toBe(112);
    // a day with nothing logged has no fill
    expect(days[0].cells.calories.pct).toBeNull();
  });
  it("a tapped day lists what they logged by meal, in meal order (a skipped meal shows, struck through)", () => {
    expect(days[6].meals.map((m) => m.slot)).toEqual(["Breakfast", "Lunch", "Dinner"]);
    expect(days[6].meals[1].items[0]).toEqual({ description: "Salad", calories: 300, skipped: true });
  });
  it("the selected day's numbers: consumed (2134 / 2143) or remaining (9 left, or 120 over)", () => {
    expect(cellText({ eaten: 2134, target: 2143, pct: 100 }, "consumed")).toBe("2,134 / 2,143");
    expect(cellText({ eaten: 2134, target: 2143, pct: 100 }, "remaining")).toBe("9 left");
    expect(cellText({ eaten: 2263, target: 2143, pct: 106 }, "remaining")).toBe("120 over");
    expect(cellText({ eaten: 900, target: null, pct: null }, "remaining")).toBe("900");
  });
  it("the week's daily average over the days they logged: calories in the ring, protein / carbs / fat in grams and share of calories", () => {
    const avg = weekAverage(days)!;
    expect(avg.loggedDays).toBe(2);
    expect(avg.calories).toBe(1600);
    expect(avg.macros.map((m) => m.key)).toEqual(["protein", "carbs", "fat"]);
    expect(avg.macros[0].grams).toBe(113);
    expect(avg.macros.reduce((s, m) => s + m.pctOfCalories, 0)).toBeGreaterThanOrEqual(99);
    expect(weekAverage(glanceDays(week([]), () => target))).toBeNull();
  });
});

describe("the weekly check-in countdown (the job runs on Mondays)", () => {
  it("counts the coach's calendar days to Monday", () => {
    expect(checkinCountdown(TODAY)).toEqual({ days: 5, label: "Check-in in 5 days" });
    expect(checkinCountdown("2026-10-25").label).toBe("Check-in tomorrow");
    expect(checkinCountdown("2026-10-26").label).toBe("Check-in today");
  });
});

describe("the day's vitamins and minerals as bars", () => {
  const e = (logDate: string, nutrients: Record<string, number> | null): LoggedEntry => ({ logDate, status: "ate_it", description: "x", calories: 300, nutrients });
  it("key nutrients with a target, as a percent of it; not reported stays null, never zero", () => {
    const bars = dayNutrientBars([e(TODAY, { iron_mg: 9 }), e("2026-10-20", { iron_mg: 18 })], TODAY, 30, "male");
    const iron = bars.find((b) => b.key === "iron_mg")!;
    expect(iron.pct).toBe(113); // 9 mg of a man's 8 mg
    expect(bars.find((b) => b.key === "calcium_mg")!.pct).toBeNull();
    // only that day: the day before is its own
    expect(dayNutrientBars([e(TODAY, { iron_mg: 9 }), e("2026-10-20", { iron_mg: 18 })], "2026-10-20", 30, "male").find((b) => b.key === "iron_mg")!.pct).toBe(225);
  });
});

describe("the weight trend card", () => {
  it("the last 30 days of weigh-ins, oldest first, and the change over them", () => {
    const s = weightSeries([{ logged_date: TODAY, weight: 180 }, { logged_date: "2026-10-01", weight: 183.5 }, { logged_date: "2026-08-01", weight: 190 }], TODAY);
    expect(s.points.map((p) => p.weight)).toEqual([183.5, 180]);
    expect(s.change).toBe(-3.5);
  });
});

describe("on the page", () => {
  it("the glance renders the grid, the day's numbers and the average", async () => {
    const { NutritionGlance } = await import("@/components/coach/nutrition/nutrition-glance");
    const days = glanceDays(week([row(TODAY, "breakfast", 2134, 145, 241, 70)]), () => ({ calories: 2143, proteinG: 141, carbsG: 233, fatG: 71 }));
    const html = renderToStaticMarkup(
      createElement(NutritionGlance, { days, average: weekAverage(days), rangeLabel: "Oct 15 – 21", nutrientsByDay: {}, weight: { points: [], change: null }, burn: null, clientName: "Johann" })
    );
    expect(html.match(/data-glance-day=/g)?.length).toBe(7);
    expect(html).toContain("2,134 / 2,143");
    expect(html).toContain("Daily average · Oct 15 – 21");
    expect(html).toContain("Tap a day to see what they logged.");
    expect(html).toContain("Shows after two weeks of logging food and weighing in.");
  });
  it("their answers read-only; unanswered says so (the coach can still answer for them)", async () => {
    const { ClientAnswersSection } = await import("@/components/coach/nutrition/client-answers-section");
    const { DEFAULT_PREFERENCES } = await import("./nutrition-preferences");
    const waiting = renderToStaticMarkup(createElement(ClientAnswersSection, { athleteId: "a", prefs: DEFAULT_PREFERENCES, answered: false, weightLbs: null, updatedByName: null, updatedAtLabel: null, clientName: "Johann" }));
    expect(waiting).toContain("Waiting on Johann&#x27;s answer");
    expect(waiting).toContain("Answer for them");
    const answered = renderToStaticMarkup(
      createElement(ClientAnswersSection, { athleteId: "a", prefs: { ...DEFAULT_PREFERENCES, allergies: ["Peanuts"], dislikes: ["Liver"] }, answered: true, weightLbs: null, updatedByName: "Johann", updatedAtLabel: "Oct 20", clientName: "Johann" })
    );
    expect(answered).toContain("Peanuts");
    expect(answered).toContain("Liver");
    expect(answered).toContain("Answered by Johann on Oct 20.");
    expect(answered).not.toContain("Save preferences");
  });
  it("the banner is gone; a coach records 'none' by saving the editor with nothing ticked", () => {
    expect(() => read("components/coach/nutrition/allergies-confirm-banner.tsx")).toThrow();
    expect(read("components/coach/nutrition/preferences-section.tsx")).toContain("|| (neverSaved && !recorded)");
  });
  it("the calculator sits at the top of the standing target card, collapsed, and only there", () => {
    const card = read("components/coach/desktop/standing-macro-target-card.tsx");
    expect(card).toContain("Set the standing target");
    expect(card).toContain("Work it out with the calculator");
    expect(card).toContain("const [calcOpen, setCalcOpen] = useState(false);");
    expect(card.indexOf("data-target-calculator")).toBeLessThan(card.indexOf("{FIELDS.map("));
    expect(read("components/coach/desktop/nutrition-tools.tsx")).not.toContain("MacroCalculator");
  });
  it("the meal planner builds from the standing target and asks nothing the weekly check-in asks", () => {
    const g = read("components/coach/desktop/meal-plan-generator.tsx");
    for (const gone of ["runCheckInEngine", "Current avg weight", "Previous avg weight", "Adherence (days/7)", "Recovery 1-5", "Current daily calories", "importedMacros"]) expect(g, gone).not.toContain(gone);
    expect(g).toContain("const dailyBaseline = targetMacros();");
    expect(g).toContain('"Set the standing target first: the plan is built from it."');
  });
  it("the weekly check-in is one section: the countdown, the last result, and Run a check-in now", () => {
    const page = read("components/coach/nutrition/client-nutrition.tsx");
    expect(page).toContain("const countdown = checkinCountdown(todayKey);");
    expect(page).toContain("Run a check-in now");
    expect(page.match(/<WeeklyCheckinPanel/g)?.length).toBe(1);
    // the switches, the body numbers, the phase review and the spotter are under the Targets card's Details
    const details = page.slice(page.indexOf("details={"), page.indexOf('<SectionHeading id="check-in"'));
    for (const c of ["<PhaseReviewCard", "<NutritionSpotterPanel", "<FoodTrackingSwitch", "<MacrosOffSwitch", "<AutoSuggestOffSwitch", "<BodyProfileEditor"]) expect(details, c).toContain(c);
  });
});
