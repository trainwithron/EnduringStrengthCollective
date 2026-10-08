# DRI data: verification log

Data file: `lib/dri-data.ts`. Checked on **2026-10-08**.

A wrong number here shows people a wrong "% of target", so every value was read from a source on the day it was
entered. Nothing was typed from memory.

## UNVERIFIED

**None.** All 24 nutrients, all 8 age groups, both sexes: every target and every upper limit (UL) was matched against
at least one National Academies table and the NIH ODS fact sheet. No value was set to `null` because it could not be
verified. (`target: null` never appears in the file; `ul: null` means "none established / not determinable".)

Two things were weaker than "two independent official sources" and are called out so nobody over-trusts them:

1. **Fiber** has no ODS fact sheet. Its numbers come from the National Academies tables only (NASEM 2019 Appendix J,
   which reproduces the IOM 2002/2005 fiber AIs). The original 2005 report's own chapter pages on nap.edu are scanned
   images (not machine-readable), so the original chapter could not be opened. A web-search summary of non-official literature (not opened directly; the CMAJ review table found was an
   image) also reported the same figures (19, 25, 31/26, 38/26, 38/25, 30/21 g) and the 14 g per 1,000 kcal rule
   (38 g and 25 g for adults), but that is weak corroboration only.
2. **Sodium** has no ODS fact sheet (the URL returns 404). It was read twice from the 2019 report (Summary Table S-2 and
   Appendix J), which are two places in the same report, not two independent publications.

## How it was checked

| Source | What it gave | URL fetched |
|---|---|---|
| NASEM 2019, *Dietary Reference Intakes for Sodium and Potassium*, **Appendix J "Dietary Reference Intakes Summary Tables"** | The Food and Nutrition Board's own consolidated RDA/AI and UL tables for every vitamin and mineral (plus fiber, sodium, potassium, CDRR, saturated-fat statement). Primary source for this file. | https://nap.nationalacademies.org/read/25353/chapter/28 |
| NASEM 2019, same report, **Summary** (Tables S-1 potassium, S-2 sodium) | Second reading of sodium AI + CDRR and potassium AI | https://nap.nationalacademies.org/read/25353/chapter/2 |
| NIH Office of Dietary Supplements Health Professional fact sheets (22 nutrients) | Independent restatement of RDA/AI and UL tables, UL scope wording | https://ods.od.nih.gov/factsheets/<Nutrient>-HealthProfessional/ for Calcium, Iron, VitaminD, Magnesium, Zinc, VitaminB12, VitaminC, Folate, VitaminA, VitaminE, VitaminK, Thiamin, Riboflavin, Niacin, VitaminB6, Choline, Phosphorus, Copper, Manganese, Selenium, Iodine, Potassium |
| FDA, Daily Value on the Nutrition and Supplement Facts Labels | Saturated fat Daily Value = 20 g (page content current as of 03/05/2024) | https://www.fda.gov/food/nutrition-facts-label/daily-value-nutrition-and-supplement-facts-labels |
| FDA, How to Understand and Use the Nutrition Facts Label | "Based on a 2,000 Calorie Diet" basis for the Daily Values (content current as of 03/05/2024) | https://www.fda.gov/food/nutrition-facts-label/how-understand-and-use-nutrition-facts-label |

Method: every table was parsed by script from the fetched pages and compared cell by cell with `lib/dri-data.ts`.
The check was proven able to fail (a deliberately wrong iron and folate value were caught).

* **NASEM 2019 Appendix J vs the data file: 656 cells compared, 0 mismatches** (all RDA/AI cells for all 24 keys, all
  ULs for the 17 nutrients that have one; choline and phosphorus ULs converted from g to mg).
* **ODS fact sheets vs the data file: 624 cells compared, 0 mismatches** (22 nutrients; ODS merges some ages, e.g.
  "19-50" or "19+", and each merged row was compared against every group it covers).
* Sodium CDRR and the sodium/potassium AIs: read by eye from Tables S-1/S-2 and Appendix J (Table 9) and match.
* After writing, the file was type-checked with `tsc --strict`, loaded, and 27 well-known values were asserted
  (iron 8/18/8, calcium 1000/1200 breakpoints, vitamin D 15/20, vitamin C 90/75, zinc 11/8, magnesium 400-420 / 310-320,
  folate 400, B12 2.4, fiber 38/25/30/21). All passed.

ODS pages were served with a `Last-Modified` header of 2026-10-08 and still cite the reports below. The agent's
web-fetch tool got HTTP 403 from ods.od.nih.gov, so the pages were downloaded with curl and parsed locally.

**Disagreements between sources: none in any number.** The only differences are wording about what a UL covers (see
the next section).

**USDA National Agricultural Library (nal.usda.gov):** checked. Its Dietary Guidance / DRI pages
(https://www.nal.usda.gov/fnic/dietary-reference-intakes, https://www.nal.usda.gov/human-nutrition-and-food-safety/dri-calculator)
are an interactive calculator and links to the National Academies reports; no static DRI table was available to
fetch, so NAL was not used as a numeric source.

## Judgement calls

* **Life-stage groups.** The reports tabulate 19-30 / 31-50 / 51-70 / ">70" (the ">" is lost in the saved pages, shown as "70 y").
  We encode ">70" as `71+`. Where a report publishes a single row for several of our groups (ODS "19-50", "51+", "19+", "14+"), the
  same number is repeated in each group. Calcium, iron, B6, vitamin D, fiber, phosphorus UL (71+ drops to 3,000 mg) and others genuinely
  change at 51 or 71 and are encoded that way.
* **Sodium.** `target` = Adequate Intake (a minimum, not a goal to eat up to). `ul` = the 2019 Chronic Disease Risk Reduction
  Intake (CDRR: "reduce intakes if above" 1,200 / 1,500 / 1,800 / 2,300 mg for 1-3 / 4-8 / 9-13 / 14+). The report states that **no UL
  was established** for sodium. `ulScope` says so, and the UI must not call this a safe upper limit.
* **Potassium.** 2019 AIs (replace the 2005 values). No UL and no CDRR could be set.
* **Vitamin D and calcium** use the 2011 IOM report. Vitamin D RDA is 15 mcg (600 IU) for 1-70 and 20 mcg (800 IU) for 71+. The ODS page and
  Appendix J agree.
* **Vitamin A UL.** Both sources say it applies to **preformed vitamin A (retinol)** from food and supplements, not to carotenoids. (The task
  brief suggested "supplements only"; the sources say food and supplements, so that is what is encoded.)
* **Vitamin B6 UL.** ODS says the UL applies to food and supplement intake together; harm has been reported only from supplements.
* **Niacin, folate, vitamin E ULs** apply only to synthetic/added forms: Appendix J footnote c, "ULs for vitamin E, niacin, and folate
  apply to synthetic forms obtained from supplements, fortified foods, or a combination of the two"; for vitamin E, footnote b adds "applies
  to any form of supplemental alpha-tocopherol". Folate food is never counted toward its UL. The folate target is in mcg DFE, the UL is in
  mcg of folic acid (not DFE); the app should not divide food DFE by the UL.
* **Magnesium UL** (65 / 110 / 350 mg) applies only to magnesium from supplements and pharmacological agents, not food or water
  (Appendix J footnote b; ODS "supplemental magnesium"). Do not show a food-only intake against it.
* **Zinc, iron, calcium, vitamin C, vitamin D, phosphorus, copper, selenium, iodine, manganese, choline**: UL covers all sources.
  Vitamin D sunlight is not counted.
* **Vitamin K, B12, thiamin, riboflavin**: no UL established (low toxicity). **Fiber**: none.
* **AI vs RDA.** AI for fiber, sodium, potassium, vitamin K, choline, manganese. RDA for the other 18.
* **Vitamin E** is alpha-tocopherol (2R forms) in mg, as in the reports; a food database that reports "vitamin E" in IU or as total
  tocopherols must be converted before comparing.
* **Niacin** is in niacin equivalents (NE); **vitamin A** in RAE; **folate** in DFE. Food data must be in the same units.
* **B12 after 50**: the report says to get most of the RDA from fortified food or a supplement (absorption from food falls); noted in `note`.
* **Iron for vegetarians** (1.8 x the RDA, from the iron report as quoted by ODS) is mentioned in the note, not applied to the numbers.
* **Smokers** need 35 mg/day more vitamin C (ODS); mentioned in the note, not applied.
* **Excluded by design:** infants (under 1 y), pregnancy, lactation. `PREGNANCY_LACTATION_NOTE` tells people to ask their clinician.
* **Saturated fat** (`SAT_FAT_INFO`): Appendix J "Additional Macronutrient Recommendations" says saturated fatty acids should be
  "as low as possible while consuming a nutritionally adequate diet"; no DRI. The only number is the FDA Daily Value, 20 g on a 2,000 calorie diet.

## Per-nutrient source log

All numbers are in `lib/dri-data.ts`; "App J" = NASEM 2019 Appendix J (URL above), "ODS" = the fact sheet named.

| Key | Unit | Kind | Report (as cited by ODS / Appendix J) | Cross-checked against | UL scope |
|---|---|---|---|---|---|
| fiber_g | g | AI | IOM 2002/2005 (Energy, Carbohydrate, Fiber, Fat...) | App J (+ weak secondary summary) | none |
| sodium_mg | mg | AI + CDRR in `ul` | NASEM 2019 Sodium and Potassium | App J, Summary Table S-2 | CDRR only, no UL |
| potassium_mg | mg | AI | NASEM 2019 | App J, Summary Table S-1, ODS Potassium | none |
| calcium_mg | mg | RDA | IOM 2011 Calcium and Vitamin D | App J, ODS Calcium | all sources |
| iron_mg | mg | RDA | IOM 2001 (Vitamin A, K, ... Iron ... Zinc) | App J, ODS Iron | all sources |
| vitamin_d_mcg | mcg | RDA | IOM 2011 | App J, ODS VitaminD | all sources |
| magnesium_mg | mg | RDA | IOM 1997 (Calcium, Phosphorus, Magnesium, Vitamin D, Fluoride) | App J, ODS Magnesium | supplements / pharmacological only |
| zinc_mg | mg | RDA | IOM 2001 | App J, ODS Zinc | all sources |
| b12_mcg | mcg | RDA | IOM 1998 (Thiamin ... Choline) | App J, ODS VitaminB12 | none |
| vitamin_c_mg | mg | RDA | IOM 2000 (Vitamin C, E, Selenium, Carotenoids) | App J, ODS VitaminC | all sources |
| folate_mcg | mcg DFE | RDA | IOM 1998 | App J, ODS Folate | synthetic folic acid only |
| vitamin_a_mcg | mcg RAE | RDA | IOM 2001 | App J, ODS VitaminA | preformed vitamin A only |
| vitamin_e_mg | mg alpha-tocopherol | RDA | IOM 2000 | App J, ODS VitaminE | supplemental alpha-tocopherol only |
| vitamin_k_mcg | mcg | AI | IOM 2001 | App J, ODS VitaminK | none |
| thiamin_mg | mg | RDA | IOM 1998 | App J, ODS Thiamin | none |
| riboflavin_mg | mg | RDA | IOM 1998 | App J, ODS Riboflavin | none |
| niacin_mg | mg NE | RDA | IOM 1998 | App J, ODS Niacin | synthetic niacin only |
| b6_mg | mg | RDA | IOM 1998 | App J, ODS VitaminB6 | all sources |
| choline_mg | mg | AI | IOM 1998 | App J, ODS Choline | all sources |
| phosphorus_mg | mg | RDA | IOM 1997 | App J, ODS Phosphorus | all sources |
| copper_mcg | mcg | RDA | IOM 2001 | App J, ODS Copper | all sources |
| manganese_mg | mg | AI | IOM 2001 | App J, ODS Manganese | all sources |
| selenium_mcg | mcg | RDA | IOM 2000 | App J, ODS Selenium | all sources |
| iodine_mcg | mcg | RDA | IOM 2001 | App J, ODS Iodine | all sources |
| sat_fat_g | g | no DRI | NASEM macronutrient recommendation (App J) | FDA Daily Value page | n/a |

IOM = Institute of Medicine, now the National Academy of Medicine (NAM). NASEM = National Academies of Sciences,
Engineering, and Medicine. Download links for the ODS pages and the nap.edu chapters are listed above and in each
nutrient's `sourceUrl`.

## Re-verifying later

The cross-check scripts live outside the repo (scratchpad); to repeat the check, re-fetch Appendix J and the 22 ODS pages,
parse the tables as above and compare cell by cell. Do this whenever the National Academies publish a new DRI report
(sodium and potassium were last updated in 2019).
