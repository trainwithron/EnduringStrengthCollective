import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { barcodeBasisLabel, scaleBarcodeResult, type BarcodeLookupResult } from "./open-food-facts";
import { copyRows } from "./food-entry";
import { noTargetLine, NO_TARGET_LINE, SELF_NO_CHECKIN_LINE, SELF_NO_TARGET_LINE } from "./nutrition-tracking";
import type { FoodLogEntry } from "@/components/athlete/meal-checkoff-list";

// FIX_NUTRITION_PHONE (Oct 20): the food log on a phone. Source-level guards plus the pure pieces.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const page = read("app/(coach)/groups/[groupId]/nutrition/page.tsx");
const section = read("components/athlete/food-log-section.tsx");

describe("page order (item 1)", () => {
  it("Today's food comes before Today's targets, the food rules and the grocery list; the injury notice and the recalc card stay on top", () => {
    const at = (s: string) => {
      const i = page.indexOf(s);
      expect(i, s).toBeGreaterThan(-1);
      return i;
    };
    expect(at("is_injured && (")).toBeLessThan(at("<RecalcPromptCard"));
    expect(at("<RecalcPromptCard")).toBeLessThan(at("<FoodLogSection"));
    expect(at("<FoodLogSection")).toBeLessThan(at("Today&apos;s targets\n"));
    expect(at("Today&apos;s targets\n")).toBeLessThan(at("<NutritionPreferencesCard"));
    expect(at("<NutritionPreferencesCard")).toBeLessThan(at("<ClientGroceryList"));
    expect(at("<ClientGroceryList")).toBeLessThan(at("{!trackingOn && nutrientData && planEstimate && ("));
    expect(at("{!trackingOn && nutrientData && planEstimate && (")).toBeLessThan(at("Weekly check-in"));
  });
  it("youth mode's protein-first targets are unchanged", () => {
    expect(page).toContain("youthMode ? (");
    expect(page).toContain("Protein target");
    expect(page).toContain("showCalories={!youthMode}");
  });
});

describe("inside Today's food (items 2 and 3)", () => {
  it("totals, the plan, the one-tap chips, search first, the other ways to log, what was logged, then the nutrients", () => {
    const order = ['data-testid="logged-totals"', "<TodaysMealCards", "<MealCheckoffList", "<FavoriteFoodChips", "<RecentFoodChips", "<FoodSearchLog", "<MyFoodsPanel", "<QuickLogFoodButton", "<BarcodeScanButton", "<PhotoLogFoodButton", "<FoodLogEntries", "<LogNutrients"];
    let last = -1;
    for (const m of order) {
      const i = section.indexOf(m);
      expect(i, m).toBeGreaterThan(last);
      last = i;
    }
    expect(read("components/athlete/todays-meal-cards.tsx")).toContain(`heading = "Today's meal plan"`);
  });
  it("the chips are no longer inside Log something else", () => {
    const quick = read("components/athlete/quick-log-food-button.tsx");
    expect(quick).not.toContain("RecentFoodChips");
    expect(quick).not.toContain("FavoriteFoodChips");
    expect(quick).not.toContain("recents");
  });
});

describe("recents keep the whole food (item 4)", () => {
  it("the page reads the detail columns (falling back to the original ones) and a tap copies the whole food into the meal for the time of day", () => {
    expect(page).toContain("const detail = await recent(FOOD_LOG_DETAIL_SELECT);");
    expect(page).toContain("(await recent(FOOD_LOG_BASE_SELECT)).data");
    expect(page).toContain(".map(entryFromRow)");
    const chips = read("components/athlete/recent-food-chips.tsx");
    expect(chips).toContain("copyRows([option.entry], { athleteId, groupId, toDate: logDate, mealSlot: defaultMealSlot(now.getHours(), now.getMinutes()) })");
    expect(chips).toContain("insertCopies(");
  });
  it("a copy into another meal keeps the nutrients, the serving and the amount", () => {
    const yogurt: FoodLogEntry = { id: "e1", mealSlot: "breakfast", status: "quick_log", description: "Greek yogurt", calories: 150, proteinG: 15, carbsG: 8, fatG: 4, foodSource: "usda", fdcId: 1, servingLabel: "cup", servingQty: 1, amountG: 227, nutrients: { calcium_mg: 250 } };
    const [row] = copyRows([yogurt], { athleteId: "a1", groupId: "g1", toDate: "2026-10-20", mealSlot: "lunch" });
    expect(row.meal_slot).toBe("lunch");
    expect(row.nutrients).toEqual({ calcium_mg: 250 });
    expect(row.serving_label).toBe("cup");
    expect(row.amount_g).toBe(227);
    expect(row.status).toBe("quick_log");
  });
});

describe("every entry gets a meal (item 5)", () => {
  const files = ["components/athlete/favorite-food-chips.tsx", "components/athlete/quick-log-food-button.tsx", "components/athlete/barcode-scan-button.tsx", "components/athlete/photo-log-food-button.tsx", "components/athlete/recent-food-chips.tsx"];
  for (const f of files) {
    it(f, () => {
      const src = read(f);
      expect(src).not.toMatch(/meal_slot: null|mealSlot: null|mealSlot=\{null\}/);
      expect(src).toContain("defaultMealSlot(");
    });
  }
});

describe("barcode amounts (item 6)", () => {
  const bar: BarcodeLookupResult = { description: "Protein bar", calories: 210, proteinG: 20, carbsG: 23, fatG: 7, basis: "serving" };
  it("scales the label for the amount eaten, rounded", () => {
    expect(scaleBarcodeResult(bar, 1)).toEqual({ result: bar });
    expect(scaleBarcodeResult(bar, 1.5)).toEqual({ result: { ...bar, calories: 315, proteinG: 30, carbsG: 35, fatG: 11 } });
    expect(scaleBarcodeResult(bar, 2)).toEqual({ result: { ...bar, calories: 420, proteinG: 40, carbsG: 46, fatG: 14 } });
  });
  it("refuses a bad amount with the same words as the own-food path", () => {
    expect(scaleBarcodeResult(bar, 0)).toEqual({ problem: "Enter an amount greater than zero." });
    expect(scaleBarcodeResult(bar, Number.NaN)).toEqual({ problem: "Enter an amount greater than zero." });
    expect(scaleBarcodeResult(bar, 101)).toEqual({ problem: "That is more than 100 servings. Check the amount." });
  });
  it("says what the numbers are per", () => {
    expect(barcodeBasisLabel("serving")).toBe("Per serving");
    expect(barcodeBasisLabel("100g")).toBe("Per 100 g");
    const scan = read("components/athlete/barcode-scan-button.tsx");
    expect(scan).toContain("{barcodeBasisLabel(result.basis)}:");
    expect(scan).toContain("scaleBarcodeResult(result, Number(servings))");
  });
});

describe("the iPhone camera (item 7)", () => {
  it("reads the code with ZXing where the browser has no BarcodeDetector, loaded only when scanning, same four formats; typing stays", () => {
    const scan = read("components/athlete/barcode-scan-button.tsx");
    expect(scan).toContain('import("@zxing/browser")');
    expect(scan).not.toMatch(/^import .*@zxing/m);
    expect(scan).toContain("[BarcodeFormat.EAN_13, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.EAN_8]");
    expect(scan).toContain("(Detector ? startNative() : startZxing())");
    expect(scan).toContain("lookup(found.getText());");
    expect(scan).toContain("Type barcode number");
    // "isn't supported" only when there is no camera to start at all
    expect(scan).toContain("if (!navigator.mediaDevices?.getUserMedia) return;");
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.dependencies["@zxing/browser"]).toBe("0.2.1");
    expect(pkg.dependencies["@zxing/library"]).toBe("0.23.0");
  });
});

describe("tap sizes (item 8)", () => {
  it("no 40 px buttons in Log something else or the barcode scan; Cancel and Try again are 44 px", () => {
    for (const f of ["components/athlete/quick-log-food-button.tsx", "components/athlete/barcode-scan-button.tsx"]) expect(read(f), f).not.toMatch(/\bh-10\b/);
    const scan = read("components/athlete/barcode-scan-button.tsx");
    expect(scan.match(/min-h-\[44px\] px-2 font-body text-xs text-steel/g)?.length).toBeGreaterThanOrEqual(3);
    const free = read("components/athlete/meal-checkoff-list.tsx");
    expect(free).toContain('className="min-h-[44px] px-2 font-body text-xs text-steel"');
    expect(free).toContain('className="min-h-[44px] px-2 font-body text-xs text-steel disabled:opacity-40"');
  });
});

describe("a coach in their own personal space", () => {
  it("is not told about 'your coach'", () => {
    expect(noTargetLine(true, true)).toBe(SELF_NO_TARGET_LINE);
    expect(SELF_NO_TARGET_LINE).toBe("No target yet. You can still track what you eat.");
    expect(noTargetLine(true)).toBe(NO_TARGET_LINE);
    expect(page).toContain("const selfCoached = isActingAsOther && athleteId === user.id;");
    expect(page).toContain("selfCoached={selfCoached}");
    expect(read("components/athlete/meal-checkoff-list.tsx")).toContain("{selfCoached ? SELF_NO_MEAL_PLAN_LINE :");
    // the weekly check-in, too
    expect(SELF_NO_CHECKIN_LINE).toBe("No weekly check-in yet.");
    expect(page).toContain("{selfCoached ? (\n                  SELF_NO_CHECKIN_LINE");
  });
  it("on another day than today the copy button says Copy the day before", () => {
    expect(page).toContain("isToday={shownIsToday}");
    expect(section).toContain("isToday={isToday}");
  });
});
