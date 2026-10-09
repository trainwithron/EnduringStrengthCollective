import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { pageDestinations } from "@/lib/workspace-destinations";

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const hub = src("../../../app/(coach)/groups/[groupId]/nutrition/page.tsx");
const profile = src("../../../app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx");
const clientNutrition = src("./client-nutrition.tsx");
const recipesPage = src("../../../app/(coach)/groups/[groupId]/recipes/page.tsx");
const calcPage = src("../../../app/(coach)/groups/[groupId]/tools/macro-calculator/page.tsx");
const card = src("../desktop/nutrition-checkin-suggestion-card.tsx");
const panel = src("../desktop/weekly-checkin-panel.tsx");
const shell = src("../coach-desktop-shell.tsx");

// Phase 1 of the Nutrition build: one place, one component, used by the hub AND the client's profile, so the two can never drift apart again.
describe("one ClientNutrition, used by the hub and by the profile", () => {
  it("both pages render the same component and neither builds the old pieces itself", () => {
    expect(hub).toContain("<ClientNutrition");
    expect(profile).toContain("<ClientNutrition");
    for (const page of [hub, profile]) {
      expect(page).not.toContain("<NutritionTools");
      expect(page).not.toContain("<WeeklyCheckinPanel");
      expect(page).not.toContain("<StandingMacroTargetCard");
      expect(page).not.toContain("<PhaseOfRecordCard");
    }
  });
  it("the component holds Targets, Preferences, Meal plan and What they ate, with the calculator inside Meal plan", () => {
    for (const id of ['id="targets"', 'id="preferences"', 'id="meal-plan"', 'id="what-they-ate"']) {
      expect(clientNutrition).toContain(id);
    }
    expect(clientNutrition).toContain("<NutritionTools");
    expect(clientNutrition).toContain("<StandingMacroTargetCard");
    expect(clientNutrition).toContain("<NutritionCheckinSuggestionsList");
    expect(clientNutrition).toContain("<WeeklyCheckinPanel");
    expect(clientNutrition).toContain("<PhaseOfRecordCard");
    expect(clientNutrition).toContain("<WhatTheyAte");
    expect(clientNutrition).toContain("#macro-calculator");
  });
  it("works out the day in the coach's own zone and the adherence count from real dates, not from the server's UTC day", () => {
    expect(clientNutrition).toContain("dateKeyInZone(timezone)");
    expect(clientNutrition).toContain("const defaultAdherenceDays = week.loggedDays;");
    expect(clientNutrition).not.toContain("toISOString().slice(0, 10)");
  });
});

describe("the hub has three tabs for the coach, and the client's page does not read them", () => {
  it("Clients (the default), Favorite meals and Calculator", () => {
    expect(hub).toContain('label: "Clients"');
    expect(hub).toContain('label: "Favorite meals"');
    expect(hub).toContain('label: "Calculator"');
    expect(hub).toContain('searchParams.tab === "favorites" || searchParams.tab === "calculator"');
    expect(hub).toContain("<FavoriteMealsTab");
  });
  it("the client's branch (below the coach branch) never reads the tab", () => {
    const clientBranch = hub.slice(hub.indexOf("// Athlete-facing branch"));
    expect(clientBranch.length).toBeGreaterThan(500);
    expect(clientBranch).not.toContain("searchParams");
    expect(clientBranch).not.toContain("tab=");
  });
});

describe("the old pages send a coach to the new tabs, and leave the client's pages alone", () => {
  it("Recipe Hub goes to Favorite meals, for a coach only", () => {
    expect(recipesPage).toContain("redirect(`/groups/${params.groupId}/nutrition?tab=favorites`)");
    expect(recipesPage.indexOf('membership?.role !== "coach"')).toBeLessThan(recipesPage.indexOf("nutrition?tab=favorites"));
    expect(recipesPage).toContain("<NoAccess>");
  });
  it("the Macro Calculator goes to the Calculator tab for a coach not acting as a client; a client's own calculator page is kept", () => {
    expect(calcPage).toContain('membership.role === "coach" && !effective.isActingAsOther');
    expect(calcPage).toContain("redirect(`/groups/${params.groupId}/nutrition?tab=calculator`)");
    expect(calcPage).toContain("initialWeight={latestWeightRow?.weight ?? null}");
    expect(calcPage).toContain("<BottomTabBar");
    expect(calcPage).not.toContain("<CoachDesktopShell");
  });
  it("one Nutrition item in the rail", () => {
    expect(shell).toContain('{ key: "nutrition", label: "Nutrition", href:');
    for (const old of ["Meal Plans", "Recipe Hub", '"Macro Calculator"']) expect(shell).not.toContain(old);
  });
  it("the workspace picker says Nutrition and keeps Favorite meals", () => {
    const G = "0b1f4c2e-aaaa-4bbb-8ccc-123456789abc";
    const all = pageDestinations(G, false);
    const byId = (k: string) => all.find((d) => d.id === `page:${k}:${G}`);
    expect(byId("nutrition")?.label).toBe("Nutrition");
    expect(byId("recipes")?.label).toBe("Favorite meals");
    expect(byId("recipes")?.path).toBe(`/groups/${G}/nutrition?tab=favorites`);
    expect(byId("macro-calculator")?.path).toBe(`/groups/${G}/nutrition?tab=calculator`);
    expect(all.map((d) => d.label)).not.toContain("Meal Plans");
    expect(all.map((d) => d.label)).not.toContain("Recipe Hub");
  });
});

describe("the standing target editor warns under the floor while the coach types", () => {
  it("shows the soft floor warning from the draft number, and never blocks a save", () => {
    const standing = src("../desktop/standing-macro-target-card.tsx");
    expect(standing).toContain("<CalorieFloorWarning calories={draft.calories.trim()");
    expect(standing).not.toMatch(/floorCalories[^\n]*disabled/);
    expect(clientNutrition).toContain("floorCalories={floorCalories}");
  });
});

describe("Apply writes the STANDING target from an apply-from date, never lies about what the client sees, and the soft floor only warns", () => {
  it("the suggestion card applies from the chosen date through applyStandingTarget, records the check-in once, and words the push by what really changed today", () => {
    expect(card).toContain("applyStandingTarget(supabase");
    expect(card).toContain("startKey, todayKey");
    expect(card).toContain("insertCheckinOnce(supabase");
    expect(card).toContain("todayChanged: applied.todayChanged");
    expect(card).not.toContain('from("daily_macros")');
    expect(card).not.toContain("targetChangeMessage");
    expect(card).toContain("clampApplyFrom(applyFrom, todayKey)");
    expect(card).toContain("<ApplyFromField");
    expect(card).toContain("<CalorieFloorWarning");
    expect(card).toContain("<ApplyOutcomeNotice");
    expect(card).toContain("Apply anyway");
  });
  it("the target is applied BEFORE the check-in is recorded, so a retry cannot duplicate the check-in", () => {
    for (const source of [card, panel]) {
      expect(source.indexOf("applyStandingTarget(supabase") !== -1 || source.indexOf('from("daily_macros").upsert') !== -1).toBe(true);
      const apply = Math.min(...["applyStandingTarget(supabase", 'from("daily_macros").upsert'].map((m) => source.indexOf(m)).filter((i) => i >= 0));
      expect(apply).toBeLessThan(source.indexOf("insertCheckinOnce(supabase"));
    }
    expect(card.indexOf("insertCheckinOnce(supabase")).toBeLessThan(card.indexOf('update({ status: "applied" })'));
  });
  it("the manual check-in defaults to the standing target from a date; a one-day target is the explicit exception; the outcome is shown", () => {
    expect(panel).toContain('useState<"standing" | "date">("standing")');
    expect(panel).toContain("startKey: standingStart, todayKey");
    expect(panel).toContain("<ApplyFromField");
    expect(panel).toContain("<CalorieFloorWarning");
    expect(panel).toContain("<ApplyOutcomeNotice");
    expect(panel).toContain("Save anyway");
  });
  it("the standing editor lists scheduled targets, asks before a save removes one, and can remove one on its own", () => {
    const standing = src("../desktop/standing-macro-target-card.tsx");
    expect(standing).toContain("scheduled.length > 0 && !await confirmDialog(scheduledConfirmMessage(scheduled))");
    expect(standing).toContain("removeScheduled(r.date)");
    expect(standing).toContain("Scheduled");
    expect(clientNutrition).toContain("scheduled={scheduledTargets}");
    expect(clientNutrition).toContain("standingForDate(standingHistory, todayKey)");
    expect(clientNutrition).not.toContain("latestStanding(");
  });
  it("the standing editor saves through applyStandingTarget too, from the server's day for the coach", () => {
    const standing = src("../desktop/standing-macro-target-card.tsx");
    expect(standing).toContain("applyStandingTarget(supabase");
    expect(standing).toContain("startKey: todayKey, todayKey");
    expect(standing).toContain("<ApplyOutcomeNotice");
    expect(standing).not.toContain("localDateKey");
  });
});

describe("the other review fixes", () => {
  it("a group-tier client's Nutrition tab on the profile shows what they logged instead of a dead end", () => {
    expect(profile).toContain("<ClientFoodLogOnly");
    expect(profile).not.toContain("isn&apos;t enabled for group-tier clients");
    expect(profile.indexOf('data-tab="nutrition"')).toBeLessThan(profile.indexOf("macrosEnabled ? ("));
  });
  it("the 7-day view resolves a day the way the client sees it: own target, else assigned plan, else standing", () => {
    expect(clientNutrition).toContain("resolveDayMacros(");
    expect(clientNutrition).toContain('.from("meal_plans").select("log_date, macros, meals")');
  });
  it("the floor says what it rests on", () => {
    expect(clientNutrition).toContain("floorBasisNote(");
    expect(clientNutrition).toContain("note={floorNote}");
  });
});
