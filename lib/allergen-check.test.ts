import { describe, expect, it } from "vitest";
import { ALLERGEN_KEYS, ALLERGEN_TERMS, checkLines, describeHit, hasSafetyHit, normalizeText, textHasAllergen, type AllergenKey } from "@/lib/allergen-check";

const allergyHits = (line: string, allergy: string) => checkLines([line], { allergies: [allergy] }).filter((h) => h.kind === "allergy");

describe("every allergen finds its own words, whole-word and plural-aware", () => {
  const cases: [AllergenKey, string[]][] = [
    ["peanut", ["2 tbsp peanut butter", "Peanuts, roasted", "chicken satay skewers", "groundnut oil"]],
    ["tree nut", ["1/4 cup almonds", "walnut pieces", "cashew cream", "pecans", "pistachio crust", "hazelnut spread", "macadamia nuts", "basil pesto", "almond butter", "marzipan", "pine nuts", "brazil nuts"]],
    ["dairy", ["1 cup whole milk", "whey protein powder", "2 tbsp butter", "ghee", "shredded cheddar cheese", "greek yogurt", "heavy cream", "casein", "kefir", "paneer cubes", "vanilla ice cream", "mozzarella", "cottage cheese", "buttermilk pancakes"]],
    ["egg", ["2 large eggs", "egg whites", "scrambled egg", "mayonnaise", "garlic aioli", "hollandaise sauce", "albumin"]],
    ["soy", ["firm tofu", "tempeh strips", "edamame", "miso paste", "soy sauce", "teriyaki glaze", "hoisin", "soybeans", "soy milk"]],
    ["wheat or gluten", ["whole wheat bread", "pasta, cooked", "flour tortilla", "breadcrumbs", "couscous", "semolina", "bulgur wheat", "orzo", "panko", "barley soup", "rye toast", "seitan", "all purpose flour", "spaghetti"]],
    ["fish", ["salmon fillet", "canned tuna", "baked cod", "tilapia", "anchovies", "fish sauce", "worcestershire sauce", "caesar dressing", "grilled mahi mahi"]],
    ["shellfish", ["shrimp", "crab meat", "lobster tail", "mussels", "clams", "scallops", "oysters", "prawns"]],
    ["sesame", ["sesame seeds", "tahini", "hummus", "sesame oil"]],
  ];
  for (const [key, lines] of cases) {
    it(`${key}: ${lines.length} lines are caught`, () => {
      for (const line of lines) {
        expect(textHasAllergen(line, key), `${key} should be found in "${line}"`).not.toBeNull();
        expect(allergyHits(line, key).length, line).toBeGreaterThan(0);
      }
    });
  }
  it("every term in every table finds itself (so a typo in the table is caught)", () => {
    for (const key of ALLERGEN_KEYS) {
      for (const term of ALLERGEN_TERMS[key]) {
        expect(textHasAllergen(`1 serving of ${term} to taste`, key), `${key}: ${term}`).not.toBeNull();
      }
    }
  });
  it("is plural-aware in both directions and for -y words", () => {
    expect(textHasAllergen("anchovies", "fish")).not.toBeNull();
    expect(textHasAllergen("2 eggs", "egg")).not.toBeNull();
    expect(textHasAllergen("walnuts", "tree nut")).not.toBeNull();
    expect(textHasAllergen("a cheese board", "dairy")).not.toBeNull();
  });
  it("ignores case and punctuation", () => {
    expect(textHasAllergen("PEANUT-BUTTER, creamy!", "peanut")).not.toBeNull();
    expect(textHasAllergen("Milk (2%)", "dairy")).not.toBeNull();
  });
});

describe("the false hits that must NOT happen", () => {
  it("coconut milk and the plant milks are not dairy", () => {
    for (const line of ["1 cup coconut milk", "almond milk, unsweetened", "oat milk", "soy milk", "rice milk", "cashew milk", "coconut cream", "coconut yogurt", "hemp milk"]) {
      expect(allergyHits(line, "dairy"), line).toEqual([]);
    }
  });
  it("but almond milk IS a tree nut, soy milk IS soy, cashew milk IS a tree nut", () => {
    expect(allergyHits("almond milk", "tree nut").length).toBeGreaterThan(0);
    expect(allergyHits("soy milk", "soy").length).toBeGreaterThan(0);
    expect(allergyHits("cashew milk", "tree nut").length).toBeGreaterThan(0);
  });
  it("peanut butter and the nut butters are not dairy butter", () => {
    for (const line of ["2 tbsp peanut butter", "almond butter", "sunflower seed butter", "cocoa butter", "shea butter", "apple butter"]) {
      expect(allergyHits(line, "dairy"), line).toEqual([]);
    }
  });
  it("butternut squash is not a tree nut, nutmeg is not a nut, a water chestnut is not a tree nut", () => {
    expect(allergyHits("roasted butternut squash", "tree nut")).toEqual([]);
    expect(allergyHits("a pinch of nutmeg", "tree nut")).toEqual([]);
    expect(allergyHits("sliced water chestnuts", "tree nut")).toEqual([]);
  });
  it("eggplant is not an egg; a flax egg is not an egg", () => {
    expect(allergyHits("grilled eggplant", "egg")).toEqual([]);
    expect(allergyHits("1 flax egg", "egg")).toEqual([]);
    expect(allergyHits("2 chia eggs", "egg")).toEqual([]);
  });
  it("buckwheat is not wheat; rice flour, almond flour and corn tortillas carry no wheat", () => {
    expect(allergyHits("buckwheat groats", "wheat or gluten")).toEqual([]);
    expect(allergyHits("rice flour", "wheat or gluten")).toEqual([]);
    expect(allergyHits("almond flour", "wheat or gluten")).toEqual([]);
    expect(allergyHits("2 corn tortillas", "wheat or gluten")).toEqual([]);
    expect(allergyHits("rice noodles", "wheat or gluten")).toEqual([]);
  });
  it("cream of tartar and a goldfish cracker are not dairy / fish", () => {
    expect(allergyHits("1 tsp cream of tartar", "dairy")).toEqual([]);
    expect(allergyHits("goldfish crackers", "fish")).toEqual([]);
  });
  it("a plant of the same name is not the animal (coconut, nutmeg and so on)", () => {
    expect(allergyHits("1 cup coconut", "tree nut")).toEqual([]);
  });
});

describe("allergies versus intolerances and dislikes", () => {
  it("an allergy is a safety hit; an intolerance and a dislike are preference hits", () => {
    const hits = checkLines(["peanut butter toast with cilantro and cheddar"], { allergies: ["peanut"], intolerances: ["lactose"], dislikes: ["cilantro"] });
    expect(hits.filter((h) => h.kind === "allergy").map((h) => h.label)).toEqual(["peanut"]);
    expect(hits.filter((h) => h.kind === "intolerance").map((h) => h.label)).toEqual(["lactose"]);
    expect(hits.filter((h) => h.kind === "dislike").map((h) => h.label)).toEqual(["cilantro"]);
    expect(hasSafetyHit(hits)).toBe(true);
    expect(hasSafetyHit(hits.filter((h) => h.kind !== "allergy"))).toBe(false);
  });
  it("'lactose' and 'gluten' typed as intolerances cover their groups", () => {
    expect(checkLines(["cheddar cheese"], { intolerances: ["lactose"] }).length).toBe(1);
    expect(checkLines(["whole wheat bread"], { intolerances: ["gluten"] }).length).toBe(1);
    expect(checkLines(["coconut milk"], { intolerances: ["lactose"] })).toEqual([]);
  });
  it("a dislike is a plain whole-word match: 'mushroom' catches mushrooms, not 'mushy'", () => {
    expect(checkLines(["sauteed mushrooms"], { dislikes: ["mushroom"] }).length).toBe(1);
    expect(checkLines(["mushy peas"], { dislikes: ["mushroom"] })).toEqual([]);
    expect(checkLines(["grilled salmon"], { dislikes: ["cilantro"] })).toEqual([]);
  });
  it("a free-text allergy ('other: kiwi') is a plain whole-word match, and a known word in 'other:' uses its group", () => {
    expect(allergyHits("kiwi and berries", "other: kiwi").length).toBe(1);
    expect(allergyHits("kiwis", "other: Kiwi").length).toBe(1);
    expect(allergyHits("kiwi", "other: ")).toEqual([]);
    expect(allergyHits("cheddar cheese", "other: dairy").length).toBe(1);
  });
  it("several allergies are each checked", () => {
    const hits = checkLines(["shrimp pad thai with peanuts and egg"], { allergies: ["shellfish", "peanut", "egg", "soy"] });
    expect(hits.map((h) => h.label).sort()).toEqual(["egg", "peanut", "shellfish"]);
  });
  it("no rules, no hits; blank lines are skipped", () => {
    expect(checkLines(["peanut butter"], {})).toEqual([]);
    expect(checkLines(["", "  "], { allergies: ["peanut"] })).toEqual([]);
  });
});

describe("diet type", () => {
  it("a vegetarian never receives meat, poultry or fish", () => {
    for (const line of ["grilled chicken breast", "lean ground beef", "turkey bacon", "baked salmon", "shrimp scampi", "pork chop", "lamb", "tuna salad"]) {
      expect(checkLines([line], { dietType: "vegetarian" }).filter((h) => h.kind === "diet").length, line).toBe(1);
    }
    expect(checkLines(["greek yogurt with honey and eggs"], { dietType: "vegetarian" })).toEqual([]);
  });
  it("a vegan also never receives dairy or egg", () => {
    expect(checkLines(["scrambled eggs"], { dietType: "vegan" }).length).toBe(1);
    expect(checkLines(["greek yogurt"], { dietType: "vegan" }).length).toBe(1);
    expect(checkLines(["tofu scramble with spinach"], { dietType: "vegan" })).toEqual([]);
    expect(checkLines(["coconut milk and oats"], { dietType: "vegan" })).toEqual([]);
  });
  it("a pescatarian never receives meat or poultry, but may have fish, shellfish, dairy and egg", () => {
    expect(checkLines(["roast chicken"], { dietType: "pescatarian" }).length).toBe(1);
    expect(checkLines(["bacon"], { dietType: "pescatarian" }).length).toBe(1);
    expect(checkLines(["salmon with cheese and eggs"], { dietType: "pescatarian" })).toEqual([]);
    expect(checkLines(["shrimp"], { dietType: "pescatarian" })).toEqual([]);
  });
  it("a plant-based line is not meat whatever it is named after", () => {
    expect(checkLines(["plant-based chicken strips"], { dietType: "vegan" })).toEqual([]);
    expect(checkLines(["vegan sausage"], { dietType: "vegetarian" })).toEqual([]);
  });
  it("omnivore, carnivore, keto and paleo add no diet hit", () => {
    for (const d of ["omnivore", "carnivore", "keto", "paleo", null, undefined]) {
      expect(checkLines(["chicken and cheese"], { dietType: d as string | null | undefined })).toEqual([]);
    }
  });
});

describe("messages and helpers", () => {
  it("describes each kind of hit in plain words", () => {
    const [allergy] = checkLines(["peanut butter"], { allergies: ["peanut"] });
    expect(describeHit(allergy)).toBe("contains peanut (allergy: peanut)");
    const [diet] = checkLines(["beef"], { dietType: "vegetarian" });
    expect(describeHit(diet)).toBe("has beef, which a vegetarian client does not eat");
    const [dis] = checkLines(["cilantro"], { dislikes: ["cilantro"] });
    expect(describeHit(dis)).toBe("contains cilantro (a food they dislike: cilantro)");
  });
  it("normalizes text to lower-case words", () => {
    expect(normalizeText("  Peanut-BUTTER,  2 tbsp! ")).toBe(" peanut butter 2 tbsp ");
  });
  it("names the line that broke the rule", () => {
    const hits = checkLines(["oats", "shrimp stir fry", "rice"], { allergies: ["shellfish"] });
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe("shrimp stir fry");
    expect(hits[0].matched).toBe("shrimp");
  });
});

describe("Assistant review: false misses that must be caught", () => {
  const caught: [string, string[]][] = [
    ["tree nut", ["1 oz mixed nuts", "trail mix", "filberts", "nougat", "amaretto", "baklava"]],
    ["peanut", ["1 oz mixed nuts", "trail mix"]],
    ["wheat or gluten", ["1 cup cooked penne", "fettuccine alfredo", "lasagna", "cheese ravioli", "gnocchi", "pizza slice", "granola", "croutons", "chicken tempura", "beer battered cod"]],
    ["dairy", ["queso dip", "provolone slices", "swiss cheese", "gruyere", "alfredo sauce", "coffee creamer", "caffe latte", "gelato", "ranch dressing", "cheesecake"]],
    ["egg", ["veggie omelette", "frittata", "quiche lorraine", "shakshuka", "spaghetti carbonara", "challah", "french toast", "eggs benedict"]],
    ["fish", ["fish roe", "caviar", "sushi roll", "salmon sashimi", "tuna poke", "bonito flakes", "grilled sole", "lox"]],
    ["shellfish", ["shrimp paella", "lobster bisque", "cioppino", "krill oil", "abalone"]],
    ["sesame", ["za'atar", "baba ganoush"]],
  ];
  for (const [key, lines] of caught) {
    it(`${key}: ${lines.length} more lines are caught`, () => {
      for (const line of lines) expect(allergyHits(line, key).length, `${key} in "${line}"`).toBeGreaterThan(0);
    });
  }
});

describe("Assistant review: plant-based food must not be flagged", () => {
  const clean: [string, string[]][] = [
    ["shellfish", ["oyster mushrooms, sauteed", "crab apple slices", "lobster mushroom"]],
    ["dairy", ["butter lettuce wraps", "butter beans", "butter squash soup", "cream of rice", "cream of coconut", "vegan cheese", "vegan butter", "vegan yogurt", "cashew cheese", "plant based cheese", "bean curd", "swiss chard"]],
    ["tree nut", ["nut free granola", "butternut squash", "nutmeg"]],
    ["peanut", ["peanut free bar", "pine nuts", "brazil nuts"]],
    ["wheat or gluten", ["wheat free bread", "gluten free pasta", "gluten free bread, 2 slices", "lettuce wrap", "rice cake", "root beer"]],
  ];
  for (const [key, lines] of clean) {
    it(`${key}: ${lines.length} lines are not flagged`, () => {
      for (const line of lines) expect(allergyHits(line, key), `${key} should not be in "${line}"`).toHaveLength(0);
    });
  }
  it("a gluten free pasta is fine, but a plain pasta beside it still is not", () => {
    expect(allergyHits("gluten free pasta with regular pasta", "wheat or gluten").length).toBeGreaterThan(0);
  });
});

describe("Assistant review: a plant-based word clears only the word it sits on", () => {
  it("chicken breast with vegan pesto is still chicken for a vegetarian", () => {
    const hits = checkLines(["Chicken breast with vegan pesto"], { dietType: "vegetarian" });
    expect(hits.map((h) => h.matched)).toContain("chicken");
  });
  it("plant based chicken and vegan sausage are fine", () => {
    expect(checkLines(["plant based chicken strips", "vegan sausage", "meatless meatballs", "veggie burger"], { dietType: "vegan" })).toHaveLength(0);
  });
  it("bone broth and pate are meat; honey is not vegan", () => {
    expect(checkLines(["bone broth"], { dietType: "vegetarian" })).toHaveLength(1);
    expect(checkLines(["pate on toast"], { dietType: "vegetarian" })).toHaveLength(1);
    expect(checkLines(["honey drizzle"], { dietType: "vegan" })).toHaveLength(1);
    expect(checkLines(["honey drizzle"], { dietType: "vegetarian" })).toHaveLength(0);
  });
});
