import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { decideAutoRefund, deliveredSince, MEAL_SLOT_DELIVERED_FEATURE, REFUNDABLE_ACTIONS } from "@/lib/ai-refund-decision";

// ai_output_foolproofing_and_quality_assurance_idea.md — a credit refund for a credit-metered AI generation, either automatic (the generation demonstrably did
// not deliver) or coach-flagged (the "This was wrong" button). Always instant and unconditional for the coach's own flag; this route never asks for a reason
// (that is a separate, optional follow-up call, see /api/ai/refund-credit/reason).
//
// "The generation did not deliver" is decided HERE, from the server's own record, never from what the browser says: the database function the browser can call
// accepts only the coach's own flag, and the automatic refund runs the server-only function after checking that the AI delivered nothing since the charge.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { action, trigger, referenceId } = (body ?? {}) as {
    action?: string;
    trigger?: string;
    referenceId?: string;
  };
  if (!action || !trigger || !referenceId) {
    return NextResponse.json({ error: "Missing fields." }, { status: 400 });
  }

  if (!(REFUNDABLE_ACTIONS as readonly string[]).includes(action)) {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }

  // The database refuses a second refund with the same reference (a unique key); that is "already refunded", not an error.
  const alreadyRefunded = (error: { code?: string } | null) => error?.code === "23505";

  if (trigger === "coach_flagged") {
    const { data: refunded, error } = await supabase.rpc("refund_coach_credit", {
      p_action: action,
      p_trigger: "coach_flagged",
      p_reference_id: referenceId,
    });
    if (alreadyRefunded(error)) return NextResponse.json({ refunded: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    // `refunded: false` means this exact generation was already refunded once before (the real, unique-constraint-backed guard against double-refunding).
    return NextResponse.json({ refunded });
  }

  if (trigger !== "auto_validator_failure") {
    return NextResponse.json({ error: "Invalid trigger." }, { status: 400 });
  }

  const service = createServiceRoleClient();
  const { data: charge } = await service
    .from("ai_charges")
    .select("id, created_at")
    .eq("coach_id", user.id)
    .eq("action", action)
    .is("refunded_at", null)
    .gt("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let delivered = 0;
  if (charge) {
    const { count } = await service
      .from("ai_usage_log")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("feature", MEAL_SLOT_DELIVERED_FEATURE)
      .gte("created_at", deliveredSince(charge.created_at));
    delivered = count ?? 0;
  }

  const decision = decideAutoRefund({ action, hasUnrefundedCharge: !!charge, deliveredSinceCharge: delivered });
  if (!decision.allow) {
    if (decision.reason === "no_charge") return NextResponse.json({ refunded: false });
    if (decision.reason === "action_not_supported") return NextResponse.json({ error: "No automatic refund exists for this action." }, { status: 400 });
    return NextResponse.json({ refunded: false, error: "The AI did deliver suggestions for this batch. If they were wrong, use 'This was wrong'." }, { status: 409 });
  }

  const { data: refunded, error } = await service.rpc("refund_coach_credit_for", {
    p_coach_id: user.id,
    p_action: action,
    p_trigger: "auto_validator_failure",
    p_reference_id: referenceId,
    // The exact charge checked above (the function re-checks it under a lock), so two requests at once can never refund each other's charges.
    p_charge_id: charge!.id,
  });
  if (alreadyRefunded(error)) return NextResponse.json({ refunded: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ refunded });
}
