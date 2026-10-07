import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const clientNutrition = src("./client-nutrition.tsx");
const generator = src("../desktop/meal-plan-generator.tsx");
const route = src("../../../app/api/ai/generate-meal-plan/route.ts");
const clientPage = src("../../../app/(coach)/groups/[groupId]/nutrition/page.tsx");
const dayPage = src("../../../app/(coach)/groups/[groupId]/programs/[programId]/calendar/[date]/page.tsx");
const dayView = src("../../athlete/day-meals-view.tsx");
const panel = src("../desktop/weekly-checkin-panel.tsx");
const cron = src("../../../app/api/cron/nutrition-checkin-suggestions/route.ts");
const clientCard = src("../../athlete/nutrition-preferences-card.tsx");
const coachSection = src("./preferences-section.tsx");

// Phase 3: food preferences and allergy safety, wired through every place a meal option can be made or shown.
describe("the coach side", () => {
  it("Preferences is a real section (not a placeholder), fed from the client's own row", () => {
    expect(clientNutrition).toContain("<PreferencesSection");
    expect(clientNutrition).not.toContain("are coming here next");
    expect(clientNutrition).toContain('from("client_nutrition_preferences").select("*").eq("athlete_id", athleteId)');
  });
  it("a coach saves everything to the client's row (one row per client), checking the protein floor first", () => {
    expect(coachSection).toContain('upsert(preferencesToRow(prefs, athleteId), { onConflict: "athlete_id" })');
    expect(coachSection).toContain("validateProteinSettings(");
    expect(coachSection).toContain('rules="edit"');
  });
  it("the assigned days are checked again, and the coach is told which conflict", () => {
    expect(clientNutrition).toContain("flaggedDays(");
    expect(clientNutrition).toContain("conflict with");
    expect(clientNutrition).toContain("They don&apos;t see the flagged options");
    expect(clientNutrition).toContain('.lte("log_date", addDaysToKey(todayKey, 13))');
  });
  it("protein is judged by the client's FLOOR, and the check-in split and the generator use the client's own target", () => {
    expect(clientNutrition).toContain("detectProteinTooLow(proteinByDay, proteinGrams.targetG, proteinGrams.floorG)");
    expect(clientNutrition).toContain("below their protein floor");
    expect(clientNutrition).not.toMatch(/baseline for their current body weight/);
    expect(clientNutrition).toContain("proteinGPerLb={prefs.proteinGPerLb}");
    expect(panel).toContain("computeArchetypeMacros(engineResult.newCalories, Number(currWeight), archetype, proteinGPerLb)");
    expect(generator).toMatch(/detectMacroArchetype\(dietaryRestrictions\),\s*proteinGPerLb/);
    expect(cron).toContain('.from("client_nutrition_preferences").select("protein_g_per_lb")');
    expect(cron).toContain("clientProteinGPerLb");
  });
  it("the check-in and generator start from the client's own rules, not retyped text", () => {
    expect(clientNutrition).toContain("restrictionsTextFromPreferences(prefs)");
    expect(clientNutrition).toContain("defaultDietaryRestrictions={rulesText}");
    expect(panel).toContain("defaultDietaryRestrictions || (lastCheckin?.dietaryRestrictions");
  });
  it("the spotter's slip check reads the new lists, and the old text check is only for a client with no preferences yet", () => {
    expect(clientNutrition).toContain("if (hasFoodRules(prefs))");
    expect(clientNutrition).toContain("} else if (lastCheckinRow?.dietary_restrictions)");
  });
});

describe("no unsafe option is ever created", () => {
  it("the AI route reads the client's rules on the server, from the database, tells the model, and drops what breaks them", () => {
    expect(route).toContain('.from("client_nutrition_preferences").select("*").eq("athlete_id", athleteId)');
    expect(route).toContain("rulesForPrompt(rules)");
    expect(route).toContain("filterOptionsByRules(checked, rules)");
    expect(route).toContain("droppedForPreferences");
    // the rules are never taken from the request body
    expect(route).not.toMatch(/allergies\s*[,}]\s*=\s*await request/);
    expect(route.indexOf("await request.json()")).toBeLessThan(route.indexOf("filterOptionsByRules(checked"));
  });
  it("the check covers the matched food too, not only the AI's own words", () => {
    expect(route).toContain("l.matchedDescription");
  });
  it("the generator sends the client id (never the rules) and filters library options, fallback options and AI options", () => {
    expect(generator).toContain("athleteId,");
    expect(generator).not.toMatch(/body: JSON\.stringify\(\{[^}]*allergies/);
    expect(generator).toContain("keepSafe(generateFullMealPlan(");
    expect(generator).toContain("filterOptionsByRules(offered, foodRules)");
    expect(generator).toContain("left out because");
    expect(clientNutrition).toContain("foodRules={foodRules}");
  });
});

describe("the client side", () => {
  it("a client edits their tastes and sees the coach's rules as text; only tastes are sent", () => {
    expect(clientCard).toContain("preferencesToRow(prefs, athleteId, { onlyTastes: true })");
    expect(clientCard).toContain('rules="readonly"');
    expect(clientPage).toContain("<NutritionPreferencesCard");
  });
  it("Today's meals hides an option that breaks their rules, and says the coach will update it", () => {
    expect(clientPage).toContain("filterPlanForClient(savedPlanMeals");
    expect(clientPage).toContain("hiddenCount={clientPlan.hiddenCount}");
    expect(dayView).toContain("Your coach is updating");
    expect(dayView).toContain("Your coach is updating this meal.");
  });
  it("the athlete's calendar day shows the same filtered plan", () => {
    expect(dayPage).toContain("filterPlanForClient(dayMeals");
    expect(dayPage).toContain("<DayMealsView meals={dayMealsView.meals}");
    expect(dayPage).not.toContain("<DayMealsView meals={dayMeals}");
  });
});

describe("Assistant review: fail closed, notices, banner", () => {
  const exportRoute = src("../../../app/api/account/export/route.ts");
  it("the AI route refuses to generate when the client's rules cannot be read", () => {
    expect(route).toContain("if (prefsError)");
    expect(route).toContain("status: 503");
    expect(route).toContain("so nothing was generated");
    expect(route).toContain("athleteId != null");
  });
  it("the client's pages hide every recipe when the rules cannot be read", () => {
    expect(clientPage).toContain("prefsError");
    expect(clientPage).toContain("hidePlanRecipes(savedPlanMeals)");
    expect(clientPage).toContain("filterGeneratedMealsForClient(todayMealsRaw, clientRules)");
    expect(dayPage).toContain("dayPrefsError");
    expect(dayPage).toContain("hidePlanRecipes(dayMeals)");
  });
  it("the coach is asked before an allergy is removed, and sees a banner for restrictions typed only in a check-in", () => {
    expect(coachSection).toContain("window.confirm(");
    expect(coachSection).toContain("Remove ");
    expect(coachSection).toContain("prefillFromRestrictionsText(prefs, checkinRestrictions)");
    expect(clientNutrition).toContain("checkinRestrictions=");
  });
  it("the client's data export includes the two new tables", () => {
    expect(exportRoute).toContain('from("client_nutrition_preferences")');
    expect(exportRoute).toContain('from("client_nutrition_feedback")');
  });
});
