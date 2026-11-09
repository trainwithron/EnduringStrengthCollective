import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { IMPORTED_FOOD_SOURCE, NOT_IMPORTED, isImportedFood, liveFoodSource } from "./imported-food";
import { loggedDateKeys, summarizeAdherence } from "./food-log-adherence";
import { dedupeRecentFoodLogs } from "./recent-food-logs";
import { copyRows } from "./food-entry";
import { itemsFromEntries } from "./saved-meal";
import type { FoodLogEntry } from "@/components/athlete/meal-checkoff-list";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const entry = (over: Partial<FoodLogEntry> = {}): FoodLogEntry => ({
  id: "e1",
  mealSlot: "lunch",
  status: "quick_log",
  description: "Rice",
  calories: 200,
  proteinG: 4,
  carbsG: 44,
  fatG: 0.4,
  foodSource: null,
  ...over,
});

describe("imported food is history only", () => {
  it("the filter keeps rows with no source and every source but import", () => {
    expect(NOT_IMPORTED).toBe("food_source.is.null,food_source.neq.import");
    expect(isImportedFood({ foodSource: IMPORTED_FOOD_SOURCE })).toBe(true);
    expect(isImportedFood({ food_source: "usda" })).toBe(false);
    expect(isImportedFood({})).toBe(false);
  });

  it("an imported day never counts as a day logged for the weekly check-in", () => {
    const rows = [
      { log_date: "2026-11-08", status: "quick_log", food_source: "import" },
      { log_date: "2026-11-07", status: "quick_log", food_source: "usda" },
      { log_date: "2026-11-06", status: "ate_it", food_source: null },
    ];
    expect(loggedDateKeys(rows)).toEqual(["2026-11-07", "2026-11-06"]);
    expect(summarizeAdherence(rows, "2026-11-09").daysLogged).toBe(2);
  });

  it("an imported food is never offered as a recent food", () => {
    const recents = dedupeRecentFoodLogs([entry({ description: "Imported oats", foodSource: "import" }), entry({ description: "Eggs", foodSource: "usda" })]);
    expect(recents.map((r) => r.entry.description)).toEqual(["Eggs"]);
  });

  it("a copy of an imported food, or a meal saved from one, is logged for real (the mark does not travel)", () => {
    expect(liveFoodSource("import")).toBeNull();
    expect(liveFoodSource("usda")).toBe("usda");
    const [copy] = copyRows([entry({ foodSource: "import", servingLabel: "1 cup" })], { athleteId: "a", groupId: "g", toDate: "2026-11-09" });
    expect(copy.food_source).toBeUndefined();
    expect(copy.serving_label).toBe("1 cup");
    expect(itemsFromEntries([entry({ foodSource: "import" })])[0].foodSource).toBeNull();
    expect(itemsFromEntries([entry({ foodSource: "custom" })])[0].foodSource).toBe("custom");
  });
});

describe("every reader that counts or credits logging leaves imported food out", () => {
  it("the weekly check-in job (days logged, the low-logging hold)", () => {
    expect(read("app/api/cron/nutrition-checkin-suggestions/route.ts")).toMatch(/\.from\("food_log_entries"\)\s*\.select\("log_date, status"\)[\s\S]{0,200}?\.or\(NOT_IMPORTED\)/);
  });
  it("the client's Nutrition tab: the 7-day view (the check-in's days logged, the protein check) and the phase review's days logged", () => {
    const src = read("components/coach/nutrition/client-nutrition.tsx");
    expect(src).toMatch(/\.select\("log_date, meal_slot, status, description, calories, protein_g, carbs_g, fat_g"\)[\s\S]{0,200}?\.or\(NOT_IMPORTED\)/);
    expect(src).toMatch(/\.select\("log_date"\)\.eq\("athlete_id", athleteId\)\.neq\("status", "skipped"\)[^;]*\.or\(NOT_IMPORTED\);/);
  });
  it("the food-log-only view for a group-tier client", () => {
    expect(read("components/coach/nutrition/client-food-log-only.tsx")).toMatch(/\.gte\("log_date", weekStartKey\)[\s\S]{0,200}?\.or\(NOT_IMPORTED\)/);
  });
  it("the coach's This week table", () => {
    expect(read("lib/coach-nutrition-week.ts")).toMatch(/from\("food_log_entries"\)[^\n]*\.or\(NOT_IMPORTED\)/);
  });
  it("the recent foods on the client's Nutrition page", () => {
    expect(read("app/(coach)/groups/[groupId]/nutrition/page.tsx")).toContain("q.or(NOT_IMPORTED)");
  });
});

describe("the upload panel and its route", () => {
  it("sits on the coach's view of the client's Nutrition tab (not on the coach's own self view)", () => {
    const page = read("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx");
    const tab = page.indexOf('<div data-tab="nutrition"');
    const panel = page.indexOf("<NutritionHistoryUploader");
    expect(tab).toBeGreaterThan(0);
    expect(panel).toBeGreaterThan(tab);
    expect(page.slice(panel - 20, panel)).toContain("!selfView");
  });
  it("the route checks the caller coaches the group and the person is a client in it before writing, and never logs rows", () => {
    const route = read("app/api/clients/nutrition-history/route.ts");
    expect(route).toContain('if (caller?.role !== "coach")');
    expect(route).toContain('if (member?.role !== "athlete")');
    expect(route.indexOf("checkCaller(groupId, athleteId)")).toBeLessThan(route.indexOf("saveImportedHistory(checked.serviceRole"));
    expect(route).not.toMatch(/console\.(log|error|warn)/);
    const save = read("lib/nutrition-history-save.ts");
    expect(save).not.toMatch(/console\.\w+\([^)]*(row|batch|description)/);
  });
  it("the file is read in the browser: the panel sends only parsed rows to our own route", () => {
    const panel = read("components/coach/nutrition/nutrition-history-uploader.tsx");
    expect(panel).toContain('fetch("/api/clients/nutrition-history"');
    expect(panel).toContain("rows: pieces[i]");
    expect(panel).not.toMatch(/FormData|console\./);
  });
});
