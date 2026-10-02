import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

// ai_output_foolproofing_and_quality_assurance_idea.md — a credit
// refund for a credit-metered AI generation, either auto-triggered
// (the generation demonstrably didn't deliver) or coach-flagged (the
// "This was wrong" button). Always instant and unconditional — this
// route never asks for or requires a reason; that's a separate,
// optional follow-up call (see /api/ai/refund-credit/reason).
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = await request.json();
  const { action, trigger, referenceId } = body as {
    action?: string;
    trigger?: string;
    referenceId?: string;
  };
  if (!action || !trigger || !referenceId) {
    return NextResponse.json({ error: "Missing fields." }, { status: 400 });
  }

  const { data: refunded, error } = await supabase.rpc("refund_coach_credit", {
    p_action: action,
    p_trigger: trigger,
    p_reference_id: referenceId,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // `refunded: false` means this exact generation was already refunded
  // once before (the real, unique-constraint-backed guard against
  // double-refunding) — not an error, just a no-op worth the caller
  // knowing about.
  return NextResponse.json({ refunded });
}
