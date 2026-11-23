import type { SupabaseClient } from "@supabase/supabase-js";
import { servingOptions, type FoodPortion, type NutrientMap, type ServingOption } from "@/lib/food-serving";
import type { FoodDetail } from "@/lib/food-search";

// The "Packaged foods" group of the food search (step 223, Ron Nov 23): brand-name products from USDA's Branded Foods, shown UNDER the everyday results and only when there are
// some. The rows come from part B's searchBranded (lib/branded-foods.ts, step 224); this file is the food search's side of it: the agreed hit shape, turning a pick into what the
// serving picker shows, and how it is logged.
//
// The shape agreed with part B (through Spot Commander, Nov 23): servingSizeUnit is "g", "ml" or null (any other unit leaves the size null, the household text is kept); brand is
// brand_name, else brand_owner; gtinUpc is digits with leading zeros removed (lib/food-barcode.ts normalizeBarcode, the form food_log_entries.barcode uses); per100g always has kcal,
// at least one macro, and a key only when reported (never 0 for "not reported").
export interface PackagedHit {
  fdcId: number; // USDA Branded fdc_id: NOT in usda_foods, so never read with loadFoodDetail
  description: string;
  brand: string | null;
  gtinUpc: string | null;
  category: string | null;
  dataType: "Branded";
  per100g: NutrientMap;
  servingSize: number | null;
  servingSizeUnit: "g" | "ml" | null;
  householdServing: string | null;
}

export type PackagedSearch = (supabase: SupabaseClient, query: string, limit?: number) => Promise<PackagedHit[] | null>;

export const PACKAGED_RESULT_LIMIT = 10;

// Wired to part B's searchBranded when the two parts are merged (until then nothing is listed, so the group never shows). null = the search failed, [] = no rows.
export const searchPackaged: PackagedSearch = async () => [];

// "Brand Description" (the brand once, even when USDA already starts the description with it).
export function packagedTitle(hit: Pick<PackagedHit, "brand" | "description">): string {
  const brand = (hit.brand ?? "").trim();
  const desc = hit.description.trim();
  if (!brand || desc.toLowerCase().startsWith(brand.toLowerCase())) return desc;
  return `${brand} ${desc}`;
}

// The label's serving as a portion the serving picker offers: "1 bar (40 g)", or for a drink labelled by volume "1 can (355 ml)" (its amounts are in ml: per100g is then per 100 ml,
// part B). Nothing when the label gives no usable size.
export function packagedPortions(hit: Pick<PackagedHit, "servingSize" | "servingSizeUnit" | "householdServing">): FoodPortion[] {
  if ((hit.servingSizeUnit !== "g" && hit.servingSizeUnit !== "ml") || !(hit.servingSize != null && hit.servingSize > 0 && hit.servingSize < 100000)) return [];
  const amount = Math.round(hit.servingSize * 10) / 10;
  const house = (hit.householdServing ?? "").trim();
  return [{ seq: 1, description: `${house || "1 serving"} (${amount} ${hit.servingSizeUnit})`.slice(0, 200), gramWeight: amount }];
}

// What the serving picker and the nutrient panel need, straight from the hit (no read).
export function packagedDetail(hit: PackagedHit): FoodDetail {
  return {
    fdcId: hit.fdcId,
    description: packagedTitle(hit),
    per100g: { ...hit.per100g },
    portions: packagedPortions(hit),
    per100Unit: hit.servingSizeUnit === "ml" ? "ml" : "g",
  };
}

// The serving choices for a drink labelled by volume: its servings, then ml. No grams or ounces (the label gives no weight). `gramWeight` here counts ml, the unit per100g is in.
export function mlServingOptions(portions: FoodPortion[]): ServingOption[] {
  return [
    ...servingOptions(portions).filter((o) => o.kind === "portion"),
    { key: "ml", label: "ml", gramWeight: 1, kind: "grams" },
  ];
}
