import { safeErrorDetail } from "@/lib/safe-error";
import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { parseOpenFoodFactsResponse, type OpenFoodFactsProduct } from "@/lib/open-food-facts";
import { lookupBrandedBarcode } from "@/lib/branded-foods";
import { lookupBarcodeInOrder } from "@/lib/barcode-lookup";

// Barcode lookup (V2 #1 from calorie_tracking_ux_research_and_plan.md). USDA's Branded Foods first (label data manufacturers send USDA, in our own database: Ron, Nov 23), then Open
// Food Facts (free, keyless, crowdsourced) exactly as before when USDA does not have the code. The answer is the same shape as before, with `source` ("usda" or "open_food_facts").
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { barcode } = await request.json();
  if (!barcode || typeof barcode !== "string" || !/^\d{6,14}$/.test(barcode.trim())) {
    return NextResponse.json({ error: "That doesn't look like a valid barcode." }, { status: 400 });
  }
  const code = barcode.trim();

  try {
    const outcome = await lookupBarcodeInOrder(code, {
      usda: (c) => lookupBrandedBarcode(supabase, c),
      openFoodFacts: async (c) => {
        const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${c}.json`, {
          headers: { "User-Agent": "SpotlightCoaching/1.0" },
        });
        if (!res.ok) return "unreachable";
        return parseOpenFoodFactsResponse((await res.json()) as OpenFoodFactsProduct);
      },
    });
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    return NextResponse.json(outcome.result);
  } catch (err) {
    const message = safeErrorDetail(err);
    return NextResponse.json({ error: `Couldn't look that up: ${message}` }, { status: 502 });
  }
}
