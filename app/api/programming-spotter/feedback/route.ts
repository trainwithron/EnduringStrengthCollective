import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

// Programming Spotter confirm/deny/edit feedback loop
// (spotter_suggestive_only_top3_confirm_deny_edit_principle_sept19.md).
// One route for all three actions — RLS on both tables
// (coach_id = auth.uid()) is the real enforcement, same convention as
// the existing /api/programming-spotter/dismiss route.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const body = await request.json();
  const { programId, checkKind, patternKey, headline, action, condition, preference } = body;

  if (!programId || !checkKind || !patternKey || !headline) {
    return NextResponse.json({ error: "programId, checkKind, patternKey, and headline are required." }, { status: 400 });
  }
  if (action !== "confirmed" && action !== "denied" && action !== "edited") {
    return NextResponse.json({ error: "action must be confirmed, denied, or edited." }, { status: 400 });
  }
  if (action === "edited" && (!condition?.trim() || !preference?.trim())) {
    return NextResponse.json({ error: "condition and preference are required for an edit." }, { status: 400 });
  }

  const dismissalKey = `${checkKind}::${patternKey}`;

  const { error: feedbackError } = await supabase.from("spotter_recommendation_feedback").insert({
    coach_id: user.id,
    spotter_kind: "programming",
    dismissal_key: dismissalKey,
    option_summary: headline,
    action,
    edit_detail: action === "edited" ? preference.trim() : null,
  });
  if (feedbackError) return NextResponse.json({ error: "Couldn't save that feedback — try again." }, { status: 500 });

  // "Deny" reuses the existing escalating dismissal mechanism (dismiss
  // twice, stop seeing it for this program) — same behavior as before
  // this feature existed, just now also logged as a raw feedback event.
  if (action === "denied") {
    const { data: existing } = await supabase
      .from("programming_spotter_dismissals")
      .select("dismissed_count")
      .eq("program_id", programId)
      .eq("check_kind", checkKind)
      .eq("pattern_key", patternKey)
      .maybeSingle();

    await supabase.from("programming_spotter_dismissals").upsert(
      {
        program_id: programId,
        check_kind: checkKind,
        pattern_key: patternKey,
        dismissed_count: (existing?.dismissed_count ?? 0) + 1,
        last_dismissed_at: new Date().toISOString(),
      },
      { onConflict: "program_id,check_kind,pattern_key" }
    );
  }

  // "Edit" extracts a real standing preference — same condition->preference
  // shape as coach_program_preferences, read into the same generate-program
  // prompt injection point (see app/api/ai/generate-program/route.ts).
  if (action === "edited") {
    const { error: prefError } = await supabase.from("spotter_coach_preferences").insert({
      coach_id: user.id,
      spotter_kind: "programming",
      condition_text: condition.trim(),
      preference_text: preference.trim(),
      source_dismissal_key: dismissalKey,
    });
    if (prefError) return NextResponse.json({ error: "Couldn't save that preference — try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
