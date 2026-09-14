import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

// The one write path for coach_program_preferences — deliberately its
// own route, separate from the chat turn itself, so a standing
// preference only ever gets saved by a real, deterministic coach click
// (the "Save this as a standing preference?" confirm button), never by
// the AI's own text output. Misreading the scope of a correction and
// silently encoding it wrong is worse than not learning it at all.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const body = await request.json();
  const condition: string = body.condition;
  const preference: string = body.preference;
  const sourceProgramId: string | null = body.sourceProgramId ?? null;

  if (!condition || typeof condition !== "string" || !condition.trim()) {
    return NextResponse.json({ error: "Missing condition." }, { status: 400 });
  }
  if (!preference || typeof preference !== "string" || !preference.trim()) {
    return NextResponse.json({ error: "Missing preference." }, { status: 400 });
  }

  const { data: row, error } = await supabase
    .from("coach_program_preferences")
    .insert({
      coach_id: user.id,
      condition_text: condition.trim(),
      preference_text: preference.trim(),
      source_program_id: sourceProgramId,
    })
    .select("id")
    .single();

  if (error || !row) {
    return NextResponse.json({ error: "Couldn't save that preference — try again." }, { status: 500 });
  }

  return NextResponse.json({ id: row.id });
}
