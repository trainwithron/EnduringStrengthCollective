import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { parseOpenFoodFactsResponse, type OpenFoodFactsProduct } from "@/lib/open-food-facts";

// V2 #1 from calorie_tracking_ux_research_and_plan.md — barcode lookup
// via Open Food Facts (free, keyless, generous rate limit; unlike the
// USDA API this needs no configuration and no graceful-degrade path).
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

  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode.trim()}.json`, {
      headers: { "User-Agent": "EnduringStrengthCollective/1.0" },
    });
    if (!res.ok) {
      return NextResponse.json({ error: "Couldn't reach the food database — try again." }, { status: 502 });
    }
    const data = (await res.json()) as OpenFoodFactsProduct;
    const result = parseOpenFoodFactsResponse(data);
    if (!result) {
      return NextResponse.json(
        { error: "No nutrition data found for that barcode — try describing it instead." },
        { status: 404 }
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Couldn't look that up: ${message}` }, { status: 502 });
  }
}
