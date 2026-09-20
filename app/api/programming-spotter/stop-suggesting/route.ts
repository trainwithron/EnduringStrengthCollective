import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

// The one-tap action behind the threshold-triggered confirm card
// ("You've said no to this 3 times — stop recommending it for this
// program?") in spotter_feedback_learning_loop_research_sept19.md, Part
// 2. Reuses the same escalating dismissal table the normal Deny action
// already writes to (programming_spotter_dismissals, suppressed once
// dismissed_count >= 2) — this just jumps straight there in one call
// instead of requiring the coach to deny it a third time manually.
// Scope is this one program, matching what the table itself already
// scopes to; a cross-program preference isn't built by this pass.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const body = await request.json();
  const { programId, checkKind, patternKey } = body;
  if (!programId || !checkKind || !patternKey) {
    return NextResponse.json({ error: "programId, checkKind, and patternKey are required." }, { status: 400 });
  }

  const { error } = await supabase.from("programming_spotter_dismissals").upsert(
    {
      program_id: programId,
      check_kind: checkKind,
      pattern_key: patternKey,
      dismissed_count: 2,
      last_dismissed_at: new Date().toISOString(),
    },
    { onConflict: "program_id,check_kind,pattern_key" }
  );
  if (error) return NextResponse.json({ error: "Couldn't save that." }, { status: 500 });

  return NextResponse.json({ ok: true });
}
