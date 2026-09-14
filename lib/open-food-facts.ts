// V2 #1 from calorie_tracking_ux_research_and_plan.md — barcode
// scanning via Open Food Facts (free, keyless, no rate limit — unlike
// the USDA API). Pure response-shaping logic, testable without a
// network call; the actual fetch lives in the API route.

export interface OpenFoodFactsProduct {
  status: number;
  product?: {
    product_name?: string;
    brands?: string;
    serving_size?: string;
    nutriments?: Record<string, number | string | undefined>;
  };
}

export interface BarcodeLookupResult {
  description: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  basis: "serving" | "100g";
}

// Prefers OFF's own per-serving figures when the product actually
// declares a serving size (more useful for a packaged food than a bare
// 100g figure); falls back to per-100g otherwise. Returns null when the
// product isn't found or carries no usable nutrition data — callers
// show a clear "not found" state rather than a fabricated zero.
export function parseOpenFoodFactsResponse(data: OpenFoodFactsProduct): BarcodeLookupResult | null {
  if (data.status !== 1 || !data.product) return null;
  const n = data.product.nutriments ?? {};

  const hasServing = data.product.serving_size && n["energy-kcal_serving"] != null;
  const suffix = hasServing ? "_serving" : "_100g";
  const basis: "serving" | "100g" = hasServing ? "serving" : "100g";

  const calories = Number(n[`energy-kcal${suffix}`]);
  const protein = Number(n[`proteins${suffix}`]);
  const carbs = Number(n[`carbohydrates${suffix}`]);
  const fat = Number(n[`fat${suffix}`]);

  if ([calories, protein, carbs, fat].some((v) => !Number.isFinite(v))) return null;

  const name = data.product.product_name?.trim() || "Scanned item";
  const brand = data.product.brands?.split(",")[0]?.trim();
  const description = brand && !name.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${name}` : name;

  return {
    description,
    calories: Math.max(0, Math.round(calories)),
    proteinG: Math.max(0, Math.round(protein)),
    carbsG: Math.max(0, Math.round(carbs)),
    fatG: Math.max(0, Math.round(fat)),
    basis,
  };
}
