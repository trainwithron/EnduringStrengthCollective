import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/supabase/client", () => ({ createBrowserClient: () => ({}) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }), usePathname: () => "/" }));

import { FoodLogSection } from "@/components/athlete/food-log-section";

const base = { athleteId: "a1", groupId: "g1", logDate: "2026-10-08", meals: [], recents: [] };
const entry = { id: "e1", mealSlot: null, status: "quick_log" as const, description: "Greek yogurt", calories: 150, proteinG: 15, carbsG: 8, fatG: 4 };

describe("FoodLogSection for a client with no target (any tier)", () => {
  it("shows running totals even before anything is logged, with the friendly line", () => {
    const html = renderToStaticMarkup(createElement(FoodLogSection, { ...base, initialEntries: [] }));
    expect(html).toContain("Logged so far today");
    expect(html).toContain("0 kcal");
    expect(html).toContain("Your coach hasn&#x27;t set a target yet. You can still track what you eat.");
  });

  it("adds up what was logged and offers the logging tools", () => {
    const html = renderToStaticMarkup(createElement(FoodLogSection, { ...base, initialEntries: [entry], target: null }));
    expect(html).toContain("150 kcal");
    expect(html).toContain("15p / 8c / 4f");
    expect(html).toContain("Greek yogurt");
    expect(html).not.toContain("hasn&#x27;t set a target yet. You can still track what you eat.</p></div></div><");
  });
});

describe("FoodLogSection for a group-tier client (no targets in their plan)", () => {
  it("does not promise a target and says what the coach can see", () => {
    const html = renderToStaticMarkup(createElement(FoodLogSection, { ...base, initialEntries: [], coachProgramming: false }));
    expect(html).toContain("Track what you eat. Targets are not part of your plan.");
    expect(html).not.toContain("hasn&#x27;t set a target yet");
    expect(html).toContain("Your coach can see what you log here.");
  });
  it("every client is told their coach can see what they log", () => {
    const html = renderToStaticMarkup(createElement(FoodLogSection, { ...base, initialEntries: [entry], target: { calories: 2200 } }));
    expect(html).toContain("Your coach can see what you log here.");
  });
});

describe("FoodLogSection for a client with a target", () => {
  it("shows the totals against the target and not the no-target line", () => {
    const html = renderToStaticMarkup(createElement(FoodLogSection, { ...base, initialEntries: [entry], target: { calories: 2200, proteinG: 180, carbsG: 220, fatG: 70 } }));
    expect(html).toContain("150 / 2200 kcal");
    expect(html).toContain("15 / 180p / 8 / 220c / 4 / 70f");
    expect(html).not.toContain("hasn&#x27;t set a target yet");
  });
});

describe("FoodLogSection on a phone (FIX_NUTRITION_PHONE)", () => {
  const recent = { key: "greek yogurt", label: "Greek yogurt", entry };
  it("shows a recent food as a one-tap chip on the first paint (no box to open)", () => {
    const html = renderToStaticMarkup(createElement(FoodLogSection, { ...base, initialEntries: [], recents: [recent] }));
    expect(html).toContain(">Recent<");
    expect(html.indexOf(">Greek yogurt<")).toBeGreaterThan(-1);
    expect(html.indexOf(">Recent<")).toBeLessThan(html.indexOf("Log something else"));
  });
  it("heads the plan Today's meal plan", () => {
    const plan = { meals: { daily: [{ mealId: "m1", title: "Breakfast", proteinTarget: 30, carbsTarget: 40, fatTarget: 10, recipes: [] }] }, hiddenCount: 0, emptiedMeals: [] };
    const html = renderToStaticMarkup(createElement(FoodLogSection, { ...base, initialEntries: [], plan } as never));
    expect(html).toContain("Today&#x27;s meal plan");
  });
  it("in the coach's own personal space it says No target yet / No meal plan yet, never 'your coach'", () => {
    const html = renderToStaticMarkup(createElement(FoodLogSection, { ...base, initialEntries: [], selfCoached: true }));
    expect(html).toContain("No target yet. You can still track what you eat.");
    expect(html).toContain("No meal plan yet.");
    expect(html).not.toContain("Your coach hasn&#x27;t");
    expect(html).not.toContain("still setting up");
  });
  it("another day's totals say which day", () => {
    const html = renderToStaticMarkup(createElement(FoodLogSection, { ...base, initialEntries: [], totalsTitle: "Logged yesterday" }));
    expect(html).toContain("Logged yesterday");
  });
});

// The Nutrition page used to refuse the whole client page to group-tier clients and skip the food-log reads. Logging is for everyone now; these keep it that way.
describe("the client Nutrition page", () => {
  const src = readFileSync(join(process.cwd(), "app/(coach)/groups/[groupId]/nutrition/page.tsx"), "utf8");
  it("no longer turns group-tier clients away", () => {
    expect(src).not.toContain("Macro programming isn&apos;t part of your current plan");
  });
  it("reads the food log for every client, not only when macros are enabled", () => {
    const foodReads = src.split("\n").filter((l) => l.includes('.from("food_log_entries")'));
    expect(foodReads.length).toBeGreaterThanOrEqual(2);
    // the day Today's food shows (today unless the day switcher picked another)
    expect(src).toContain("fetchFoodLogDay(supabase, athleteId, shownDay)");
    for (const line of foodReads) expect(line).not.toMatch(/macrosEnabled/);
    // none of the three food-log reads sits right after a "macrosEnabled ?" gate
    expect(src).not.toMatch(/macrosEnabled\s*\?\s*supabase\s*\.from\("food_log_entries"\)/);
  });
  it("shows a coach the food log of a group-tier client instead of a dead end", () => {
    expect(src).toContain("ClientFoodLogOnly");
    expect(src).not.toContain("isn&apos;t enabled for group-tier clients");
    const profile = readFileSync(join(process.cwd(), "app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx"), "utf8");
    expect(profile).toContain("ClientFoodLogOnly");
    expect(profile).not.toContain("isn&apos;t enabled for group-tier clients");
  });
});
