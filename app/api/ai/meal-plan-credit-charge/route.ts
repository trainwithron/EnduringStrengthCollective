import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { checkAndSpendCoachCredits } from "@/lib/coach-credits";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

// credit_topup_low_tier_monetization_idea.md — nutrition plan
// generation is priced as ONE 3-credit charge for a whole plan, not per
// meal slot. The real per-meal AI call
// (app/api/ai/generate-meal-plan/route.ts) stays free/unmetered as a
// personal reroll convenience — this is the single charge point
// components/coach/desktop/meal-plan-generator.tsx's "AI Suggest All"
// bulk action hits exactly once before looping over that same free
// per-meal endpoint for every slot in the current view.
export async function POST() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const spend = await checkAndSpendCoachCredits(createServiceRoleClient(), user.id, "nutrition_plan");
  if (!spend.ok) {
    return NextResponse.json({ error: spend.error }, { status: 402 });
  }

  return NextResponse.json({ ok: true, balance: spend.balance, unlimited: spend.unlimited });
}
