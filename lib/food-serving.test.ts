import { describe, expect, it } from "vitest";
import {
  GRAMS_PER_OUNCE,
  defaultServing,
  formatAmount,
  gramsFor,
  macrosOf,
  per100gFromSnapshot,
  quantityProblem,
  scaleNutrients,
  servingOptions,
  servingText,
} from "@/lib/food-serving";

describe("formatAmount", () => {
  it("always shows both units", () => {
    expect(formatAmount(100)).toBe("100 g (3.5 oz)");
    expect(formatAmount(28.3495)).toBe("28.3 g (1 oz)");
    expect(formatAmount(158)).toBe("158 g (5.6 oz)");
  });
});

describe("servingOptions", () => {
  it("lists household measures first, in USDA order, then grams and ounces", () => {
    const opts = servingOptions([
      { seq: 2, description: "1 tbsp", gramWeight: 9.9 },
      { seq: 1, description: "1 cup", gramWeight: 158 },
    ]);
    expect(opts.map((o) => o.label)).toEqual(["1 cup", "1 tbsp", "grams", "ounces"]);
    expect(opts[3].gramWeight).toBe(GRAMS_PER_OUNCE);
  });
  it("still offers grams and ounces when USDA has no household measure", () => {
    expect(servingOptions([]).map((o) => o.kind)).toEqual(["grams", "ounces"]);
    expect(servingOptions().map((o) => o.kind)).toEqual(["grams", "ounces"]);
  });
  it("drops a portion with no weight or no name", () => {
    const opts = servingOptions([
      { seq: 1, description: "", gramWeight: 50 },
      { seq: 2, description: "1 slice", gramWeight: 0 },
      { seq: 3, description: "1 medium", gramWeight: 118 },
    ]);
    expect(opts.map((o) => o.label)).toEqual(["1 medium", "grams", "ounces"]);
  });
});

describe("defaultServing", () => {
  it("starts on the first household measure at 1, else 100 grams", () => {
    const withPortion = defaultServing(servingOptions([{ seq: 1, description: "1 cup", gramWeight: 158 }]));
    expect(withPortion.option.label).toBe("1 cup");
    expect(withPortion.qty).toBe(1);
    const none = defaultServing(servingOptions([]));
    expect(none.option.kind).toBe("grams");
    expect(none.qty).toBe(100);
  });
});

describe("gramsFor and quantityProblem", () => {
  const cup = servingOptions([{ seq: 1, description: "1 cup", gramWeight: 158 }])[0];
  const oz = servingOptions([])[1];
  it("converts a quantity of a serving to grams", () => {
    expect(gramsFor(cup, 1.5)).toBe(237);
    expect(gramsFor(oz, 4)).toBe(113.4);
  });
  it("refuses zero, negative, not-a-number and absurd amounts", () => {
    expect(gramsFor(cup, 0)).toBeNull();
    expect(gramsFor(cup, -1)).toBeNull();
    expect(gramsFor(cup, Number.NaN)).toBeNull();
    expect(gramsFor(cup, 20000)).toBeNull();
    expect(quantityProblem(cup, 0)).toBe("Enter an amount greater than zero.");
    expect(quantityProblem(cup, 1000)).toBe("That comes to more than 20 kg; check the amount.");
    expect(quantityProblem(cup, 2)).toBeNull();
  });
});

describe("scaleNutrients", () => {
  it("scales every reported nutrient from per-100 g and leaves unreported ones out (never zero)", () => {
    const out = scaleNutrients({ kcal: 130, protein_g: 2.7, carbs_g: 28.2, fat_g: 0.3 }, 158);
    expect(out).toEqual({ kcal: 205.4, protein_g: 4.266, carbs_g: 44.556, fat_g: 0.474 });
    expect("fiber_g" in out).toBe(false);
  });
  it("round-trips through the stored snapshot", () => {
    const per100 = { kcal: 130, protein_g: 2.7, carbs_g: 28.2 };
    const snap = scaleNutrients(per100, 237);
    const back = per100gFromSnapshot(snap, 237);
    expect(back.kcal).toBeCloseTo(130, 1);
    expect(back.protein_g).toBeCloseTo(2.7, 1);
  });
});

describe("macrosOf", () => {
  it("uses the food's own energy value", () => {
    expect(macrosOf({ kcal: 205.4, protein_g: 4.27, carbs_g: 44.56, fat_g: 0.47 })).toEqual({ calories: 205, proteinG: 4.3, carbsG: 44.6, fatG: 0.5, caloriesComputed: false });
  });
  it("works calories out from the macros (4/4/9) when the food reports none, and says so", () => {
    const m = macrosOf({ protein_g: 10, carbs_g: 20, fat_g: 5 });
    expect(m.calories).toBe(165);
    expect(m.caloriesComputed).toBe(true);
  });
});

describe("servingText", () => {
  it("shows the household measure with both units", () => {
    expect(servingText({ servingLabel: "1 cup", servingQty: 1.5, amountG: 237 })).toBe("1.5 x 1 cup (237 g (8.4 oz))");
  });
  it("shows just the amount for grams and ounces", () => {
    expect(servingText({ servingLabel: "grams", servingQty: 100, amountG: 100 })).toBe("100 g (3.5 oz)");
    expect(servingText({ servingLabel: null, servingQty: null, amountG: null })).toBe("");
  });
});
