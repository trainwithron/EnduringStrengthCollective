import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { diffDraft, type DraftRow } from "@/lib/edit-diff";
import { detectSwapPatterns, patternKey, suggestionText } from "@/lib/edit-patterns";

// Signing off an AI-built program: it becomes active (the one update that clears the draft flag), and, quietly, the changes the coach made to the AI's draft are noted so the
// app can learn how they coach. Learning never blocks or changes the sign-off: if anything in it fails, the program is still signed off. At most ONE quiet suggestion comes back,
// only when a change has been made often enough, never one already asked about, and never when the coach has turned questions off.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const programId = typeof body.programId === "string" ? body.programId : "";
  if (!programId) return NextResponse.json({ error: "Missing program." }, { status: 400 });

  const { data: program } = await supabase.from("programs").select("id, group_id, ai_draft, ai_snapshot").eq("id", programId).maybeSingle();
  if (!program) return NextResponse.json({ error: "Program not found." }, { status: 404 });
  const { data: membership } = await supabase.from("group_memberships").select("role").eq("group_id", program.group_id).eq("profile_id", user.id).maybeSingle();
  if (membership?.role !== "coach") return NextResponse.json({ error: "Only the coach can sign off a program." }, { status: 403 });
  if (!program.ai_draft) return NextResponse.json({ ok: true, suggestion: null });

  const { error: updateError } = await supabase.from("programs").update({ ai_draft: false, is_active: true }).eq("id", programId);
  if (updateError) return NextResponse.json({ error: "That didn't save. The program is still a draft." }, { status: 500 });

  let suggestion: { id: string; text: string } | null = null;
  try {
    const snapshot = Array.isArray(program.ai_snapshot) ? (program.ai_snapshot as DraftRow[]) : null;
    if (snapshot && snapshot.length > 0) {
      const { data: workouts } = await supabase
        .from("workouts")
        .select("week_number, day_index, group_workout_exercises ( exercise_name, exercise_order, group_workout_exercise_sets ( target_reps ) )")
        .eq("program_id", programId);
      const after: DraftRow[] = [];
      for (const w of (workouts ?? []) as any[]) {
        for (const e of w.group_workout_exercises ?? []) {
          const sets = e.group_workout_exercise_sets ?? [];
          after.push({ week: w.week_number, day: w.day_index, order: e.exercise_order, name: e.exercise_name, sets: sets.length, reps: sets[0]?.target_reps ?? null });
        }
      }
      const events = diffDraft(snapshot, after).slice(0, 200);
      if (events.length > 0) {
        await supabase.from("coach_edit_events").insert(events.map((e) => ({ coach_id: user.id, program_id: programId, kind: e.kind, from_name: e.from, to_name: e.to, detail: e.detail })));
      }
      await supabase
        .from("coach_program_signoffs")
        .upsert({ program_id: programId, coach_id: user.id, exercises: Array.from(new Set(snapshot.map((r) => r.name))), edits_count: events.length, questions_asked: 0 });

      const { data: settings } = await supabase.from("coach_learning_settings").select("questions_enabled").eq("coach_id", user.id).maybeSingle();
      const asking = (settings as { questions_enabled?: boolean } | null)?.questions_enabled !== false;
      if (asking && events.some((e) => e.kind === "swap")) {
        const { data: recent } = await supabase.from("coach_program_signoffs").select("program_id, exercises").eq("coach_id", user.id).order("signed_at", { ascending: false }).limit(10);
        const signoffs = ((recent ?? []) as { program_id: string; exercises: string[] }[]).map((s) => ({ programId: s.program_id, exercises: s.exercises }));
        const { data: swaps } = await supabase
          .from("coach_edit_events")
          .select("program_id, from_name, to_name")
          .eq("coach_id", user.id)
          .eq("kind", "swap")
          .in("program_id", signoffs.map((s) => s.programId));
        const { data: asked } = await supabase.from("coach_learned_rules").select("from_name, to_name").eq("coach_id", user.id);
        const askedKeys = new Set(((asked ?? []) as { from_name: string; to_name: string }[]).map((r) => patternKey(r.from_name, r.to_name)));
        const [pattern] = detectSwapPatterns(
          signoffs,
          ((swaps ?? []) as { program_id: string; from_name: string; to_name: string }[]).map((s) => ({ programId: s.program_id, from: s.from_name, to: s.to_name })),
          askedKeys
        );
        if (pattern) {
          const { data: rule } = await supabase
            .from("coach_learned_rules")
            .insert({ coach_id: user.id, kind: "swap", from_name: pattern.from, to_name: pattern.to, status: "suggested", evidence_count: pattern.count, evidence_total: pattern.total, asked_for_program_id: programId })
            .select("id")
            .single();
          if (rule) {
            suggestion = { id: rule.id, text: suggestionText(pattern) };
            await supabase.from("coach_program_signoffs").update({ questions_asked: 1 }).eq("program_id", programId);
          }
        }
      }
    }
  } catch {
    // Learning is quiet and never blocks the sign-off.
  }
  return NextResponse.json({ ok: true, suggestion });
}
