import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

// Programming Spotter — dismissal memory. "Dismiss twice, stop seeing it
// for that pattern" (programming_spotter_program_review_idea.md): each
// call increments this program's own count for that exact (check, pattern)
// pair; the gather layer stops surfacing it once dismissed_count >= 2.
// RLS (spotter_dismissals_coach_manage) is the real enforcement — this
// route just does the read-then-increment, low contention (a coach
// clicking one button), so no need for an atomic RPC.
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

  const { data: existing } = await supabase
    .from("programming_spotter_dismissals")
    .select("dismissed_count")
    .eq("program_id", programId)
    .eq("check_kind", checkKind)
    .eq("pattern_key", patternKey)
    .maybeSingle();

  const { error } = await supabase.from("programming_spotter_dismissals").upsert(
    {
      program_id: programId,
      check_kind: checkKind,
      pattern_key: patternKey,
      dismissed_count: (existing?.dismissed_count ?? 0) + 1,
      last_dismissed_at: new Date().toISOString(),
    },
    { onConflict: "program_id,check_kind,pattern_key" }
  );
  if (error) return NextResponse.json({ error: "Couldn't save the dismissal." }, { status: 500 });

  return NextResponse.json({ ok: true });
}
