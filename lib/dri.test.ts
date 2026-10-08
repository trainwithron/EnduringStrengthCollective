import { describe, expect, it } from "vitest";
import { DRI_GROUPS, DRI_NUTRIENTS } from "@/lib/dri-data";
import { assumptionNote, groupKeysForAge, referenceFor } from "@/lib/dri";

// Independent spot checks of the published Dietary Reference Intakes (National Academies; NIH Office of Dietary Supplements fact sheets), written from the published tables rather than
// from the data file, so a typo in the table is caught here. The full cell-by-cell verification is in docs/DRI_SOURCES.md.
const t = (key: string, age: number, sex: "male" | "female") => referenceFor(key, age, sex)?.target;
const ul = (key: string, age: number, sex: "male" | "female") => referenceFor(key, age, sex)?.ul;

describe("the table is complete", () => {
  it("covers 8 age groups for every nutrient, both sexes", () => {
    expect(DRI_GROUPS.map((g) => g.key)).toEqual(["1-3", "4-8", "9-13", "14-18", "19-30", "31-50", "51-70", "71+"]);
    for (const n of DRI_NUTRIENTS) {
      for (const g of DRI_GROUPS) {
        expect(n.values[g.key]?.male, `${n.key} ${g.key} male`).toBeDefined();
        expect(n.values[g.key]?.female, `${n.key} ${g.key} female`).toBeDefined();
      }
      expect(n.source.length).toBeGreaterThan(10);
      expect(n.sourceUrl).toMatch(/^https:\/\//);
    }
  });
  it("every number is positive and every target is an RDA or an AI", () => {
    for (const n of DRI_NUTRIENTS) for (const g of DRI_GROUPS) for (const s of ["male", "female"] as const) {
      const e = n.values[g.key][s];
      expect(e.target == null || e.target > 0, `${n.key} ${g.key} ${s}`).toBe(true);
      expect(e.ul == null || e.ul > 0).toBe(true);
      expect(["RDA", "AI"]).toContain(e.kind);
    }
  });
});

describe("well-known adult values", () => {
  it("iron: 8 mg for men, 18 mg for women 19-50, 8 mg for women 51+; teens 11 and 15", () => {
    expect(t("iron_mg", 25, "male")).toBe(8);
    expect(t("iron_mg", 25, "female")).toBe(18);
    expect(t("iron_mg", 45, "female")).toBe(18);
    expect(t("iron_mg", 55, "female")).toBe(8);
    expect(t("iron_mg", 16, "male")).toBe(11);
    expect(t("iron_mg", 16, "female")).toBe(15);
    expect(ul("iron_mg", 30, "male")).toBe(45);
  });
  it("calcium: 1,000 mg adults, 1,200 for women 51+ and men 71+, 1,300 for 9-18", () => {
    expect(t("calcium_mg", 30, "male")).toBe(1000);
    expect(t("calcium_mg", 40, "female")).toBe(1000);
    expect(t("calcium_mg", 55, "female")).toBe(1200);
    expect(t("calcium_mg", 55, "male")).toBe(1000);
    expect(t("calcium_mg", 75, "male")).toBe(1200);
    expect(t("calcium_mg", 12, "female")).toBe(1300);
    expect(t("calcium_mg", 16, "male")).toBe(1300);
    expect(t("calcium_mg", 5, "male")).toBe(1000);
    expect(t("calcium_mg", 2, "female")).toBe(700);
    expect(ul("calcium_mg", 30, "female")).toBe(2500);
    expect(ul("calcium_mg", 60, "female")).toBe(2000);
  });
  it("vitamin D: 15 mcg to age 70, 20 mcg after; upper limit 100", () => {
    expect(t("vitamin_d_mcg", 30, "male")).toBe(15);
    expect(t("vitamin_d_mcg", 70, "female")).toBe(15);
    expect(t("vitamin_d_mcg", 71, "female")).toBe(20);
    expect(t("vitamin_d_mcg", 2, "male")).toBe(15);
    expect(ul("vitamin_d_mcg", 30, "male")).toBe(100);
  });
  it("vitamin C: 90 and 75 mg adults; teens 75 and 65", () => {
    expect(t("vitamin_c_mg", 30, "male")).toBe(90);
    expect(t("vitamin_c_mg", 30, "female")).toBe(75);
    expect(t("vitamin_c_mg", 16, "male")).toBe(75);
    expect(t("vitamin_c_mg", 16, "female")).toBe(65);
    expect(t("vitamin_c_mg", 10, "male")).toBe(45);
    expect(ul("vitamin_c_mg", 30, "male")).toBe(2000);
  });
  it("zinc 11 and 8 mg; magnesium 400/420 and 310/320; B12 2.4; folate 400", () => {
    expect(t("zinc_mg", 30, "male")).toBe(11);
    expect(t("zinc_mg", 30, "female")).toBe(8);
    expect(ul("zinc_mg", 30, "male")).toBe(40);
    expect(t("magnesium_mg", 25, "male")).toBe(400);
    expect(t("magnesium_mg", 40, "male")).toBe(420);
    expect(t("magnesium_mg", 25, "female")).toBe(310);
    expect(t("magnesium_mg", 40, "female")).toBe(320);
    expect(t("b12_mcg", 30, "male")).toBe(2.4);
    expect(t("folate_mcg", 30, "female")).toBe(400);
    expect(t("folate_mcg", 10, "female")).toBe(300);
    expect(ul("folate_mcg", 30, "female")).toBe(1000);
  });
  it("fiber AI: 38 and 25 g to 50, then 30 and 21 g", () => {
    expect(t("fiber_g", 30, "male")).toBe(38);
    expect(t("fiber_g", 30, "female")).toBe(25);
    expect(t("fiber_g", 60, "male")).toBe(30);
    expect(t("fiber_g", 60, "female")).toBe(21);
    expect(referenceFor("fiber_g", 30, "male")?.kind).toBe("AI");
  });
  it("potassium AI (2019): 3,400 mg men, 2,600 mg women; sodium AI 1,500 with the 2,300 mg chronic-disease level", () => {
    expect(t("potassium_mg", 30, "male")).toBe(3400);
    expect(t("potassium_mg", 30, "female")).toBe(2600);
    expect(t("sodium_mg", 30, "male")).toBe(1500);
    expect(ul("sodium_mg", 30, "male")).toBe(2300);
    expect(referenceFor("sodium_mg", 30, "male")?.ulScope).toMatch(/not a safe upper limit|chronic/i);
  });
  it("other vitamins and minerals", () => {
    expect(t("vitamin_a_mcg", 30, "male")).toBe(900);
    expect(t("vitamin_a_mcg", 30, "female")).toBe(700);
    expect(ul("vitamin_a_mcg", 30, "male")).toBe(3000);
    expect(t("vitamin_e_mg", 30, "male")).toBe(15);
    expect(t("vitamin_k_mcg", 30, "male")).toBe(120);
    expect(t("vitamin_k_mcg", 30, "female")).toBe(90);
    expect(t("thiamin_mg", 30, "male")).toBe(1.2);
    expect(t("thiamin_mg", 30, "female")).toBe(1.1);
    expect(t("riboflavin_mg", 30, "male")).toBe(1.3);
    expect(t("riboflavin_mg", 30, "female")).toBe(1.1);
    expect(t("niacin_mg", 30, "male")).toBe(16);
    expect(t("niacin_mg", 30, "female")).toBe(14);
    expect(t("b6_mg", 30, "male")).toBe(1.3);
    expect(t("b6_mg", 60, "male")).toBe(1.7);
    expect(t("b6_mg", 60, "female")).toBe(1.5);
    expect(ul("b6_mg", 30, "male")).toBe(100);
    expect(t("choline_mg", 30, "male")).toBe(550);
    expect(t("choline_mg", 30, "female")).toBe(425);
    expect(t("phosphorus_mg", 30, "male")).toBe(700);
    expect(t("copper_mcg", 30, "male")).toBe(900);
    expect(t("manganese_mg", 30, "male")).toBe(2.3);
    expect(t("manganese_mg", 30, "female")).toBe(1.8);
    expect(t("selenium_mcg", 30, "male")).toBe(55);
    expect(ul("selenium_mcg", 30, "male")).toBe(400);
    expect(t("iodine_mcg", 30, "female")).toBe(150);
  });
});

describe("referenceFor: what happens when we do not know the person", () => {
  it("a known age and sex is an exact group with no assumption", () => {
    const r = referenceFor("iron_mg", 25, "female");
    expect(r).toMatchObject({ target: 18, assumedAge: false, assumedSex: false });
    expect(assumptionNote(r!)).toBeNull();
    expect(r!.groupLabel).toContain("19-30");
  });
  it("unknown sex averages men and women and says so", () => {
    const r = referenceFor("iron_mg", 25, null);
    expect(r).toMatchObject({ target: 13, assumedSex: true, assumedAge: false });
    expect(assumptionNote(r!)).toMatch(/average of men and women/);
  });
  it("unknown age uses the average of the adult groups and says so", () => {
    const r = referenceFor("iron_mg", null, "female");
    expect(r).toMatchObject({ target: 18, assumedAge: true, assumedSex: false });
    expect(assumptionNote(r!)).toMatch(/adult average/);
    const both = referenceFor("iron_mg", null, null);
    expect(both).toMatchObject({ target: 13, assumedAge: true, assumedSex: true });
    expect(assumptionNote(both!)).toMatch(/age and sex/);
  });
  it("a person outside the table gets no reference at all", () => {
    expect(referenceFor("iron_mg", 0, "male")).toBeNull();
    expect(referenceFor("iron_mg", 130, "male")).toBeNull();
    expect(referenceFor("iron_mg", Number.NaN, "male")).toBeNull();
    expect(referenceFor("not_a_nutrient", 30, "male")).toBeNull();
  });
  it("age boundaries land in the right group", () => {
    expect(groupKeysForAge(1)?.keys).toEqual(["1-3"]);
    expect(groupKeysForAge(3)?.keys).toEqual(["1-3"]);
    expect(groupKeysForAge(4)?.keys).toEqual(["4-8"]);
    expect(groupKeysForAge(18)?.keys).toEqual(["14-18"]);
    expect(groupKeysForAge(19)?.keys).toEqual(["19-30"]);
    expect(groupKeysForAge(50)?.keys).toEqual(["31-50"]);
    expect(groupKeysForAge(51)?.keys).toEqual(["51-70"]);
    expect(groupKeysForAge(70)?.keys).toEqual(["51-70"]);
    expect(groupKeysForAge(71)?.keys).toEqual(["71+"]);
    expect(groupKeysForAge(null)).toEqual({ keys: ["19-30", "31-50"], assumed: true });
  });
  it("saturated fat has no reference intake", () => {
    expect(referenceFor("sat_fat_g", 30, "male")).toBeNull();
  });
});
