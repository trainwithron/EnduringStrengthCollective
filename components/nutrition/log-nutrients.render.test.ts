import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { LogNutrients } from "@/components/nutrition/log-nutrients";
import { FoodNutrientPanel, previewNutrients, reportedCount } from "@/components/nutrition/food-nutrient-panel";
import { NUTRIENT_CATALOG } from "@/lib/nutrient-catalog";
import { datesEndingOn, NUTRIENT_KEYS, pastDaysFor } from "@/lib/nutrient-view";
import { dayTotals, type LoggedEntry } from "@/lib/nutrient-day";

const TODAY = "2026-10-08";
const meal = (date: string, nutrients: Record<string, number> | null): LoggedEntry => ({ logDate: date, status: "quick_log", description: "Food", calories: 700, nutrients });
const day = (date: string, calcium: number): LoggedEntry[] => Array.from({ length: 4 }, () => meal(date, { calcium_mg: calcium / 4 }));

// `all` is the whole log (past days and today); the page adds up the past on the server and passes today's entries live.
function render(all: LoggedEntry[], over: Record<string, unknown> = {}) {
  const props = {
    groupId: "g1",
    athleteId: "a1",
    todayKey: TODAY,
    pastDays: pastDaysFor(all, TODAY),
    age: 30,
    sex: "male" as const,
    entries: all.filter((e) => e.logDate === TODAY),
    audience: "client" as const,
    clientName: "Sam",
    ...over,
  };
  return renderToStaticMarkup(createElement(LogNutrients, props));
}

describe("vitamins and minerals with the food log", () => {
  it("sits with the log as a short list: a reported nutrient shows its amount, its percent of the reference and a button that opens its detail", () => {
    const html = render(day(TODAY, 500));
    expect(html).toContain('aria-label="Calcium: details"');
    expect(html).toContain("500 mg");
    expect(html).toContain("50% of");
    expect(html).toContain("1000 mg (RDA)");
    expect(html).toContain(`Show all ${NUTRIENT_CATALOG.length}`);
    // the short list, not all 24
    expect((html.match(/<li/g) ?? []).length).toBe(5);
    // the detail is a panel over the log (nothing opens until a nutrient is tapped), never a link to another page
    expect(html).not.toContain("<a ");
    expect(html).not.toContain('data-testid="nutrient-sheet"');
  });
  it("a nutrient nothing reports is 'Not reported', never 0", () => {
    const html = render(day(TODAY, 500));
    expect(html).toContain("Not reported");
    expect(html).not.toMatch(/Iron<\/span><span[^>]*>0 mg/);
  });
  it("says how many of today's foods carry detail", () => {
    const html = render([meal(TODAY, { calcium_mg: 100 }), meal(TODAY, null)]);
    expect(html).toContain("1 of 2 foods logged today has vitamin and mineral detail");
  });
  it("with nothing logged it is one calm line, and a coach is told the client logged nothing", () => {
    expect(render([])).toContain("Log a food and its vitamins and minerals show up here");
    expect(render([], { audience: "coach" })).toContain("Sam hasn&#x27;t logged any food today.");
    expect(render([])).not.toContain("Show all");
  });
  it("labels a meal-plan estimate plainly, with how many ingredients were matched, and never as logged food", () => {
    const html = render([], { planEstimate: { totals: { calcium_mg: 600 }, coveredIngredientCount: 7, totalIngredientCount: 10 } });
    expect(html).toContain("An ESTIMATE from today&#x27;s meal plan, not from food you logged");
    expect(html).toContain("7 of 10 planned ingredients matched");
    expect(html).toContain("estimated from the meal plan");
    expect(html).not.toContain("Log a food and its vitamins");
  });
  it("says plainly when the earlier days rest on part of the log", () => {
    expect(render(day(TODAY, 500), { partialLog: true })).toContain("based on part of the log");
    expect(render(day(TODAY, 500))).not.toContain("based on part of the log");
  });
  it("when sex is unknown it still shows amounts, adds a gentle line, and gives no 'Worth a look'", () => {
    const iron = datesEndingOn(TODAY, 6).flatMap((d) => Array.from({ length: 4 }, () => meal(d, { iron_mg: 2 })));
    const html = render(iron, { sex: null });
    expect(html).toContain("Add your sex in About you for personal targets");
    expect(html).toContain("8 mg");
    expect(html).not.toContain("Worth a look");
    expect(render(iron, { sex: null, audience: "coach" })).toContain("until the client&#x27;s sex and date of birth are filled in");
    expect(render(iron, { sex: "male" })).not.toContain("Add your sex in About you");
  });
  it("shows the assumption note only when age or sex is missing", () => {
    expect(render(day(TODAY, 500), { age: null, sex: null })).toContain("adult average");
    expect(render(day(TODAY, 500))).not.toContain("adult average");
  });
  it("surfaces a kind 'Worth a look' inline for a nutrient that has run low, with coach wording for a coach, and never alarming", () => {
    const entries = datesEndingOn(TODAY, 6).flatMap((d) => day(d, 300));
    const client = render(entries);
    expect(client).toContain("Worth a look");
    expect(client).toContain("on the low side");
    expect(client).not.toMatch(/deficien|diagnos|remaining|left today|over by/i);
    const coach = render(entries, { audience: "coach" });
    expect(coach).toContain("Worth a look");
    expect(coach).toContain("for Sam");
  });
  it("shows no 'Worth a look' when nothing is low", () => {
    expect(render(datesEndingOn(TODAY, 6).flatMap((d) => day(d, 1000)))).not.toContain("Worth a look");
  });
  it("is calm: the bars use the calm colour and nothing is red", () => {
    const html = render(datesEndingOn(TODAY, 6).flatMap((d) => day(d, 300)));
    expect(html).toContain("bg-moss");
    expect(html).not.toContain("bg-rust");
    expect(html).not.toContain("text-rust");
    expect(html).not.toContain("bg-red");
  });
  it("updates the moment another food is logged, from the same past days", () => {
    const past = pastDaysFor([], TODAY);
    const one = [meal(TODAY, { calcium_mg: 200 })];
    const two = [...one, meal(TODAY, { calcium_mg: 300 })];
    const html1 = renderToStaticMarkup(createElement(LogNutrients, { groupId: "g1", athleteId: "a1", todayKey: TODAY, pastDays: past, age: 30, sex: "male", entries: one, audience: "client" }));
    const html2 = renderToStaticMarkup(createElement(LogNutrients, { groupId: "g1", athleteId: "a1", todayKey: TODAY, pastDays: past, age: 30, sex: "male", entries: two, audience: "client" }));
    expect(html1).toContain("200 mg");
    expect(html2).toContain("500 mg");
    expect(dayTotals(TODAY, two, NUTRIENT_KEYS).byKey.calcium_mg.total).toBe(500);
  });
});

describe("the vitamins and minerals in one logged food", () => {
  const food = { calcium_mg: 120, iron_mg: 2.1, fiber_g: 3, potassium_mg: 400, vitamin_c_mg: 9, sodium_mg: 80 };
  it("counts what the food reports and previews up to four of the usual nutrients, in the usual order", () => {
    expect(reportedCount(food)).toEqual({ reported: 6, total: NUTRIENT_CATALOG.length });
    expect(previewNutrients(food).map((p) => p.key)).toEqual(["fiber_g", "potassium_mg", "calcium_mg", "iron_mg"]);
    expect(previewNutrients(null)).toEqual([]);
  });
  it("shows a line with the key ones and the full list one tap away, with 'Not reported' for the rest, never zero", () => {
    const html = renderToStaticMarkup(createElement(FoodNutrientPanel, { nutrients: food }));
    expect(html).toContain("<details");
    expect(html).toContain(`6 of ${NUTRIENT_CATALOG.length} reported`);
    expect(html).toContain("Fiber 3 g");
    expect(html).toContain("Not reported");
    expect(html).not.toMatch(/Zinc<\/span><span[^>]*>0 /);
  });
  it("shows nothing for a food with no vitamin and mineral detail (a quick calorie entry or a photo estimate)", () => {
    expect(renderToStaticMarkup(createElement(FoodNutrientPanel, { nutrients: null }))).toBe("");
    expect(renderToStaticMarkup(createElement(FoodNutrientPanel, { nutrients: {} }))).toBe("");
  });
});

describe("where it sits", () => {
  const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
  it("the client's food log shows it directly under the day's calories and macros, fed by the entries as they change", () => {
    const log = src("../athlete/food-log-section.tsx");
    expect(log).toContain("<LogNutrients");
    expect(log.indexOf("<LogNutrients")).toBeGreaterThan(log.indexOf('data-testid="logged-totals"'));
    expect(log.indexOf("<LogNutrients")).toBeLessThan(log.indexOf("<TodaysMealCards"));
    expect(log).toContain("entries={loggedToday}");
    expect(log).toContain("allEntries.map(");
  });
  it("each logged food shows its own vitamins and minerals on its row", () => {
    expect(src("../athlete/food-log-entries.tsx")).toContain("<FoodNutrientPanel nutrients={entry.nutrients} />");
  });
  it("the old standalone Vitamins and minerals section and the coach's Nutrients section are gone; the coach sees the same list inside What they ate", () => {
    const page = src("../../app/(coach)/groups/[groupId]/nutrition/page.tsx");
    expect(page).not.toContain("NutrientsSection");
    expect(page).not.toContain("<h2 className=\"font-display uppercase text-sm tracking-wide text-steel mb-2\">Vitamins and minerals</h2>");
    expect(page).toContain("nutrients={nutrientData}");
    const coach = src("../coach/nutrition/client-nutrition.tsx");
    expect(coach).not.toContain("NutrientsSection");
    expect(coach).not.toContain('id="nutrients"');
    expect(coach).not.toContain('href="#nutrients"');
    expect(coach).toContain("<CoachLogNutrients");
    expect(coach.indexOf("<CoachLogNutrients")).toBeGreaterThan(coach.indexOf('id="what-they-ate"'));
    expect(coach.indexOf("<CoachLogNutrients")).toBeLessThan(coach.indexOf('id="macro-calculator"') > 0 ? coach.indexOf('id="macro-calculator"') : coach.length);
  });
  it("the nutrient's own page and the panel over the log share one body", () => {
    expect(src("../../app/(coach)/groups/[groupId]/nutrition/nutrients/[key]/page.tsx")).toContain("<NutrientDetailView facts={facts} />");
    expect(src("./nutrient-detail-sheet.tsx")).toContain("<NutrientDetailView facts={facts} />");
  });
});
