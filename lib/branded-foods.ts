import type { SupabaseClient } from "@supabase/supabase-js";
import type { NutrientMap } from "@/lib/food-serving";
import { tokenize } from "@/lib/food-search";
import { normalizeBarcode } from "@/lib/food-barcode";
import type { BarcodeLookupResult } from "@/lib/open-food-facts";

// Brand-name packaged foods from USDA's Branded Foods (public.usda_branded_foods, migration 0468; Ron, Nov 23: the food search rebuild, part B). Two uses:
//   * searchBranded(): the "Packaged foods" group under the everyday results of the food search (part A's UI).
//   * the barcode lookup (app/api/food/barcode): USDA's label data first, Open Food Facts only when USDA does not have the code.

export interface BrandedHit {
  // USDA Branded fdc_id. It is NOT in usda_foods: never passed to loadFoodDetail, and logged with fdc_id null.
  fdcId: number;
  description: string;
  // brand_name, falling back to brand_owner
  brand: string | null;
  // digits only, leading zeros removed: the stored form (lib/food-barcode.ts normalizeBarcode), the same one food_log_entries.barcode uses
  gtinUpc: string | null;
  // USDA's branded_food_category
  category: string | null;
  dataType: "Branded";
  // per 100 g (per 100 ml for a drink, as USDA publishes it); a key is absent when not reported, never 0. kcal is always there.
  per100g: NutrientMap;
  servingSize: number | null;
  // "g" or "ml" only (the import reads USDA's GRM / MLT); null with servingSize when the label gives another unit
  servingSizeUnit: "g" | "ml" | null;
  // the label's own words: "1 bar", "2 tbsp"
  householdServing: string | null;
}

export interface BrandedRow {
  fdc_id: number;
  gtin: string | null;
  brand_owner: string | null;
  brand_name: string | null;
  description: string;
  category: string | null;
  serving_size: number | string | null;
  serving_size_unit: string | null;
  household_serving: string | null;
  kcal: number | string | null;
  protein_g: number | string | null;
  carbs_g: number | string | null;
  fat_g: number | string | null;
  fiber_g: number | string | null;
  sugars_g: number | string | null;
  sodium_mg: number | string | null;
}

export const BRANDED_SELECT = "fdc_id, gtin, brand_owner, brand_name, description, category, serving_size, serving_size_unit, household_serving, kcal, protein_g, carbs_g, fat_g, fiber_g, sugars_g, sodium_mg";
const NUTRIENT_COLUMNS = ["kcal", "protein_g", "carbs_g", "fat_g", "fiber_g", "sugars_g", "sodium_mg"] as const;

const numberOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const text = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
};

export function brandedHitFromRow(row: BrandedRow): BrandedHit {
  const per100g: NutrientMap = {};
  for (const k of NUTRIENT_COLUMNS) {
    const n = numberOrNull(row[k]);
    if (n !== null) per100g[k] = n;
  }
  const unit = row.serving_size_unit === "g" || row.serving_size_unit === "ml" ? row.serving_size_unit : null;
  const size = numberOrNull(row.serving_size);
  return {
    fdcId: Number(row.fdc_id),
    description: row.description,
    brand: text(row.brand_name) ?? text(row.brand_owner),
    gtinUpc: text(row.gtin),
    category: text(row.category),
    dataType: "Branded",
    per100g,
    servingSize: unit && size !== null && size > 0 ? size : null,
    servingSizeUnit: unit && size !== null && size > 0 ? unit : null,
    householdServing: text(row.household_serving),
  };
}

/** The packaged foods for a search, best first. null when the search could not be done (a failed read), [] when nothing matches. */
export async function searchBranded(supabase: SupabaseClient, query: string, limit = 10): Promise<BrandedHit[] | null> {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  try {
    const { data, error } = await supabase.rpc("search_branded_foods", { p_tokens: tokens, p_limit: Math.min(Math.max(Math.round(limit), 1), 50) });
    if (error) return null;
    return ((data ?? []) as BrandedRow[]).map(brandedHitFromRow);
  } catch {
    return null;
  }
}

// ---- barcodes ----

// A UPC-E (the short 8-digit code on small packages) written out as the UPC-A it stands for, so it finds the product stored under its full code. null when it is not a UPC-E.
export function expandUpcE(code: string): string | null {
  const d = code.replace(/\D/g, "");
  if (d.length !== 8 || (d[0] !== "0" && d[0] !== "1")) return null;
  const ns = d[0];
  const [d1, d2, d3, d4, d5, d6] = d.slice(1, 7).split("");
  const check = d[7];
  let body: string;
  if (d6 === "0" || d6 === "1" || d6 === "2") body = `${d1}${d2}${d6}0000${d3}${d4}${d5}`;
  else if (d6 === "3") body = `${d1}${d2}${d3}00000${d4}${d5}`;
  else if (d6 === "4") body = `${d1}${d2}${d3}${d4}00000${d5}`;
  else body = `${d1}${d2}${d3}${d4}${d5}0000${d6}`;
  return `${ns}${body}${check}`;
}

/** The stored forms a scanned or typed code may be under: the code itself (UPC-A, EAN-13 and GTIN-14 all strip to one value), and the UPC-A of a UPC-E. */
export function barcodeCandidates(code: string): string[] {
  const out = new Set<string>();
  const plain = normalizeBarcode(code);
  if (plain !== "" && plain.length <= 14) out.add(plain);
  const expanded = expandUpcE(code);
  if (expanded) {
    const e = normalizeBarcode(expanded);
    if (e !== "") out.add(e);
  }
  return [...out];
}

// A USDA label as the barcode lookup returns it: per serving when the label gives a serving in grams or millilitres, else per 100 g; the brand in front of the name unless the name
// already says it. The same rounding as the Open Food Facts lookup. null when it has no protein, carbs or fat at all (nothing to log).
export function brandedBarcodeResult(row: BrandedRow): BarcodeLookupResult | null {
  const hit = brandedHitFromRow(row);
  const p = hit.per100g;
  if (p.kcal === undefined || (p.protein_g === undefined && p.carbs_g === undefined && p.fat_g === undefined)) return null;
  const perServing = hit.servingSize !== null && hit.servingSizeUnit !== null;
  const scale = perServing ? (hit.servingSize as number) / 100 : 1;
  const round = (v: number | undefined) => Math.max(0, Math.round((v ?? 0) * scale));
  const name = hit.description;
  const description = hit.brand && !name.toLowerCase().includes(hit.brand.toLowerCase()) ? `${hit.brand} ${name}` : name;
  return { description, calories: round(p.kcal), proteinG: round(p.protein_g), carbsG: round(p.carbs_g), fatG: round(p.fat_g), basis: perServing ? "serving" : "100g" };
}

/** USDA's label for a barcode: the most recently published row under any of its stored forms. null when USDA does not have it, or the table cannot be read (then the caller asks
 *  Open Food Facts, as before). */
export async function lookupBrandedBarcode(supabase: SupabaseClient, code: string): Promise<BarcodeLookupResult | null> {
  const candidates = barcodeCandidates(code);
  if (candidates.length === 0) return null;
  try {
    const { data, error } = await supabase.from("usda_branded_foods").select(BRANDED_SELECT).in("gtin", candidates).order("published_date", { ascending: false, nullsFirst: false }).limit(1);
    if (error || !data || data.length === 0) return null;
    return brandedBarcodeResult(data[0] as unknown as BrandedRow);
  } catch {
    return null;
  }
}
