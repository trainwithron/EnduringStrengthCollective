import type { BarcodeLookupResult } from "@/lib/open-food-facts";

// The order a barcode is looked up in (Ron, Nov 23: the food search rebuild): USDA's Branded Foods first (the label data manufacturers send USDA), then Open Food Facts (crowdsourced)
// exactly as before. Pure apart from the two lookups it is handed, so the order is tested (lib/branded-foods.test.ts).
export type BarcodeSource = "usda" | "open_food_facts";
export type BarcodeOutcome =
  | { ok: true; result: BarcodeLookupResult & { source: BarcodeSource } }
  | { ok: false; status: 404 | 502; error: string };

export const NOT_FOUND = "No nutrition data found for that barcode — try describing it instead.";
export const UNREACHABLE = "Couldn't reach the food database — try again.";

export async function lookupBarcodeInOrder(
  code: string,
  lookups: {
    usda: (code: string) => Promise<BarcodeLookupResult | null>;
    // "unreachable" when Open Food Facts could not be asked (it is the last place to look, so that is said)
    openFoodFacts: (code: string) => Promise<BarcodeLookupResult | null | "unreachable">;
  },
): Promise<BarcodeOutcome> {
  const usda = await lookups.usda(code).catch(() => null);
  if (usda) return { ok: true, result: { ...usda, source: "usda" } };
  const off = await lookups.openFoodFacts(code);
  if (off === "unreachable") return { ok: false, status: 502, error: UNREACHABLE };
  if (!off) return { ok: false, status: 404, error: NOT_FOUND };
  return { ok: true, result: { ...off, source: "open_food_facts" } };
}
