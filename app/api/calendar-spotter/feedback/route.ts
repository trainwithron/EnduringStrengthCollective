import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

// Calendar Spotter Phase 2 confirm/deny/edit feedback loop — same
// principle and same shared spotter_recommendation_feedback table as
// Programming Spotter's (spotter_suggestive_only_top3_confirm_deny_
// edit_principle_sept19.md), tagged spotter_kind: "calendar". No
// per-pattern "standing preference" text sink exists for scheduling
// suggestions yet, so "edited" here means "I'm going to go adjust the
// actual setting" (the caller deep-links to Availability) rather than a
// typed condition/preference pair — still logged as a real feedback
// event either way.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const body = await request.json();
  const { checkKind, patternKey, headline, action } = body;

  if (!checkKind || !patternKey || !headline) {
    return NextResponse.json({ error: "checkKind, patternKey, and headline are required." }, { status: 400 });
  }
  if (action !== "confirmed" && action !== "denied" && action !== "edited") {
    return NextResponse.json({ error: "action must be confirmed, denied, or edited." }, { status: 400 });
  }

  const { error } = await supabase.from("spotter_recommendation_feedback").insert({
    coach_id: user.id,
    spotter_kind: "calendar",
    dismissal_key: `${checkKind}::${patternKey}`,
    option_summary: headline,
    action,
  });
  if (error) return NextResponse.json({ error: "Couldn't save that feedback — try again." }, { status: 500 });

  return NextResponse.json({ ok: true });
}
