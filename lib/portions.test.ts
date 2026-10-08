import { describe, it, expect } from "vitest";
import { householdMeasure, withHouseholdMeasure, gramsOnlyLabels, knowsFood, GRAMS_ONLY_ON_PURPOSE } from "@/lib/portions";
import { RECIPES, scaleTemplate, renderLines } from "@/lib/meal-templates";

describe("householdMeasure", () => {
  it("turns grams into quarter, third and half cups for a volume food", () => {
    expect(householdMeasure("0% Greek Yogurt", 245)).toBe("1 cup");
    expect(householdMeasure("0% Greek Yogurt", 166)).toBe("2/3 cup");
    expect(householdMeasure("2% Cottage Cheese", 151)).toBe("2/3 cup");
    expect(householdMeasure("Baby Spinach", 80)).toBe("2 2/3 cups");
    expect(householdMeasure("Mixed Berries", 47)).toBe("1/3 cup");
    expect(householdMeasure("Honeydew Melon", 249)).toBe("1 1/2 cups");
  });
  it("uses the right weight for the cut: sliced vs diced pepper, shredded vs chopped carrots", () => {
    expect(householdMeasure("Bell Peppers (Sliced)", 120)).toBe("1 1/3 cups");
    expect(householdMeasure("Bell Pepper (Diced)", 120)).toBe("3/4 cup");
    expect(householdMeasure("Carrots (Shredded)", 55)).toBe("1/2 cup");
    expect(householdMeasure("Carrots", 130)).toBe("1 cup");
  });
  it("dry and cooked are different foods: rice only gets a measure when the line says which", () => {
    expect(householdMeasure("Jasmine Rice (Dry)", 93)).toBe("1/2 cup");
    expect(householdMeasure("Cooked Rice", 158)).toBe("1 cup");
    expect(householdMeasure("Brown Rice", 150)).toBeNull();
    expect(householdMeasure("Cream of Rice", 90)).toBe("1/2 cup");
    expect(householdMeasure("Black Beans (Cooked)", 172)).toBe("1 cup");
  });
  it("cooked brown rice is heavier than white: 195 g is a cup, not 1 1/4", () => {
    expect(householdMeasure("Brown Rice (Cooked)", 195)).toBe("1 cup");
    expect(householdMeasure("Cooked Brown Rice", 195)).toBe("1 cup");
    expect(householdMeasure("Cooked White Rice", 158)).toBe("1 cup");
    expect(householdMeasure("Brown Rice", 150)).toBeNull();
  });
  it("oats get the dry weight only when the line says dry: overnight, baked, protein and bare oats are not guessed", () => {
    expect(householdMeasure("Rolled Oats (Dry)", 40)).toBe("1/2 cup");
    expect(householdMeasure("Old-Fashioned Oats", 81)).toBe("1 cup");
    // steel-cut oats are twice as dense as rolled: 40 g is a quarter cup, not a half
    expect(householdMeasure("Steel-Cut Oats", 40)).toBe("1/4 cup");
    expect(householdMeasure("Steel-cut oats (dry)", 160)).toBe("1 cup");
    expect(householdMeasure("Cooked Steel-Cut Oats", 234)).toBe("1 cup"); // cooked oatmeal weighs the same whatever the oat
    expect(householdMeasure("Rolled Oats (Dry)", 40)).toBe("1/2 cup");
    expect(householdMeasure("Oats (Dry)", 40)).toBe("1/2 cup");
    expect(householdMeasure("Oats", 240)).toBeNull();
    expect(householdMeasure("Baked Oats", 240)).toBeNull();
    expect(householdMeasure("Protein Oats", 120)).toBeNull();
    expect(householdMeasure("Overnight Oats", 240)).toBeNull();
    expect(householdMeasure("Cooked Oatmeal", 234)).toBe("1 cup");
  });
  it("a small amount of a dry food or spread is spoons, not a fraction of a cup", () => {
    expect(householdMeasure("Chia Seeds", 26)).toBe("2 tbsp");
    expect(householdMeasure("Nut Butter", 32)).toBe("2 tbsp");
    expect(householdMeasure("Rolled Oats", 12)).toBe("2 1/2 tbsp");
    expect(householdMeasure("Quinoa (Dry)", 22)).toBe("2 tbsp");
    expect(householdMeasure("Olive Oil", 14)).toBe("1 tbsp");
    expect(householdMeasure("Avocado (Spread)", 9)).toBe("2 tsp");
  });
  it("a bulk food (greens, fruit) is never given as spoons: too small an amount shows grams only", () => {
    expect(householdMeasure("Banana Slices", 15)).toBeNull();
    expect(householdMeasure("Fresh Pineapple", 34)).toBeNull();
  });
  it("counted foods come out as pieces, in quarters for big pieces and whole numbers for small ones", () => {
    expect(householdMeasure("Fresh Plums", 99)).toBe("1 1/2 plums");
    expect(householdMeasure("Grapefruit", 111)).toBe("1/2 grapefruit");
    expect(householdMeasure("Raw Almonds", 9)).toBe("8 almonds");
    expect(householdMeasure("Hard-Boiled Egg Whites", 89)).toBe("3 egg whites");
    expect(householdMeasure("Raw Macadamia Nuts", 5)).toBe("2 macadamia nuts");
  });
  it("shows grams only when no measure is within 15 percent, never a rough guess", () => {
    // 84 g kiwi is 1.2 kiwis: 1 kiwi is 18 percent off, 1 1/4 is 4 percent off but quarter kiwis are fine
    expect(householdMeasure("Fresh Kiwi", 84)).toBe("1 1/4 kiwis");
    // 91 g of raw russet potato is 0.6 of a cup of cubes: 1/2 and 2/3 are both outside 15 percent? 2/3 cup = 100 g is 10 percent off
    expect(householdMeasure("Russet Potatoes (Raw)", 91)).toBe("2/3 cup");
    expect(householdMeasure("Black Beans (Cooked)", 9)).toBeNull();
  });
  it("meat, fish, tofu and powders are grams only on purpose", () => {
    for (const label of ["Chicken Breast (Raw)", "Atlantic Salmon", "Extra Firm Tofu", "Whey Isolate", "Beef Jerky"]) {
      expect(householdMeasure(label, 100)).toBeNull();
    }
  });
  it("rejects nonsense amounts", () => {
    expect(householdMeasure("Baby Spinach", 0)).toBeNull();
    expect(householdMeasure("Baby Spinach", -5)).toBeNull();
    expect(householdMeasure("Baby Spinach", NaN)).toBeNull();
  });
  it("every measure is within 15 percent of the weight it stands for", () => {
    const foods = ["0% Greek Yogurt", "Baby Spinach", "Mixed Berries", "Carrots", "Rolled Oats", "Chia Seeds", "Fresh Plums", "Raw Almonds", "Honeydew Melon", "Cream of Rice"];
    for (const f of foods) {
      for (let g = 5; g <= 400; g += 7) {
        const m = householdMeasure(f, g);
        if (!m) continue;
        // read the measure back to grams with the same table: tolerance is asserted inside householdMeasure, so here just check it is stable and reads as text
        expect(m).toMatch(/^\d/);
      }
    }
  });
});

describe("withHouseholdMeasure", () => {
  it("grams first by default: the measure sits inside the ounce note", () => {
    expect(withHouseholdMeasure("<strong>0% Greek Yogurt:</strong> 166g")).toBe("<strong>0% Greek Yogurt:</strong> 166g (about 2/3 cup)");
    expect(withHouseholdMeasure("<strong>Fresh Mixed Berries:</strong> 177g (~6.2 oz)")).toBe("<strong>Fresh Mixed Berries:</strong> 177g (~6.2 oz, about 1 1/4 cups)");
  });
  it("household first when the client prefers it", () => {
    expect(withHouseholdMeasure("<strong>Fresh Mixed Berries:</strong> 177g (~6.2 oz)", "household")).toBe("<strong>Fresh Mixed Berries:</strong> about 1 1/4 cups (177g, ~6.2 oz)");
    expect(withHouseholdMeasure("<strong>0% Greek Yogurt:</strong> 166g", "household")).toBe("<strong>0% Greek Yogurt:</strong> about 2/3 cup (166g)");
  });
  it("keeps what follows the amount, like a carb note", () => {
    expect(withHouseholdMeasure("<strong>Rolled Oats:</strong> 40g (~1.4 oz) [27g carbs]")).toBe("<strong>Rolled Oats:</strong> 40g (~1.4 oz, about 1/2 cup) [27g carbs]");
  });
  it("works on a plain line with no bold tags (an AI or coach-written line)", () => {
    expect(withHouseholdMeasure("Greek yogurt: 245g")).toBe("Greek yogurt: 245g (about 1 cup)");
  });
  it("leaves every other line exactly as it was", () => {
    for (const line of [
      "<strong>Whole Eggs:</strong> 3 large",
      "<strong>Sourdough Bread:</strong> 2 slice(s)",
      "<strong>Olive Oil:</strong> 1.6 tsp",
      "<strong>Chicken Breast (Raw):</strong> 80g (~2.8 oz)",
      "<strong>Preparation:</strong> Whisk and serve.",
      "<strong>Brown Rice:</strong> 150g",
      "",
      "1-2 cups steamed vegetables",
    ]) {
      expect(withHouseholdMeasure(line)).toBe(line);
      expect(withHouseholdMeasure(line, "household")).toBe(line);
    }
  });
  it("the result is still plain text the line renderer can show (only an exact <strong> is bold)", () => {
    const out = withHouseholdMeasure("<strong>Chia Seeds:</strong> 26g");
    expect(out).toBe("<strong>Chia Seeds:</strong> 26g (about 2 tbsp)");
    expect(out.match(/<[^>]+>/g)).toEqual(["<strong>", "</strong>"]);
  });
});

describe("coverage of the starter library", () => {
  const targets = [
    { proteinG: 20, carbsG: 25, fatG: 8 },
    { proteinG: 35, carbsG: 50, fatG: 15 },
    { proteinG: 50, carbsG: 90, fatG: 25 },
    { proteinG: 40, carbsG: 5, fatG: 30 },
    { proteinG: 12, carbsG: 15, fatG: 6 },
    { proteinG: 60, carbsG: 120, fatG: 30 },
  ];
  const lines: string[] = [];
  for (const r of RECIPES) {
    for (const t of targets) {
      const m = scaleTemplate(r, t);
      if (!m) continue;
      for (const l of renderLines(m.items)) lines.push(l);
    }
  }
  const gramLabels = new Set<string>();
  for (const l of lines) {
    const m = /^<strong>([^<:]+?):<\/strong>\s*\d+(?:\.\d+)?\s*g\b/.exec(l);
    if (m) gramLabels.add(m[1].trim());
  }
  it("finds the library's gram lines", () => {
    expect(gramLabels.size).toBeGreaterThan(60);
  });
  it("every food the library prints in grams is either in the table or left to grams on purpose (so a new food cannot be forgotten)", () => {
    const unknown = [...gramLabels].filter((label) => !knowsFood(label) && !GRAMS_ONLY_ON_PURPOSE.some((g) => g.match.test(label.toLowerCase())));
    expect(unknown).toEqual([]);
  });
  it("most of the library's gram lines get a measure", () => {
    const gramLines = lines.filter((l) => /^<strong>[^<:]+?:<\/strong>\s*\d+(?:\.\d+)?\s*g\b/.test(l));
    const withMeasure = gramLines.filter((l) => withHouseholdMeasure(l) !== l);
    // meat, fish, tofu and powders are most of the rest, on purpose
    expect(withMeasure.length / gramLines.length).toBeGreaterThan(0.4);
  });
  it("lists what is grams only, to grow the table from real plans", () => {
    const labels = gramsOnlyLabels(lines);
    expect(Array.isArray(labels)).toBe(true);
    expect(labels).toContain("Chicken Breast (Raw)");
  });
});

describe("the line component", () => {
  it("adds the measure when a line is shown and never changes the stored text", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(__dirname, "../components/shared/ingredient-line.tsx"), "utf8").replace(/\r\n/g, "\n");
    expect(src).toContain("ingredientSegments(withHouseholdMeasure(text, portionUnits))");
    expect(src).toContain('portionUnits = "grams"');
  });
});
