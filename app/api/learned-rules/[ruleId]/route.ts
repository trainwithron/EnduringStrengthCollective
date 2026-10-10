import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { preferenceFor } from "@/lib/edit-patterns";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The coach's answer to a learned-rule suggestion. A rule only starts to apply when the coach says Yes (it becomes a line in their standing preferences, which the builder
// already reads); No is final (never asked again); Undo takes the line out. A reason the coach gave, and the plain rule read back to them, is kept with the rule.
// Everything is the coach's own (row security): nobody else can read or change it.
export async function POST(request: Request, props: { params: Promise<{ ruleId: string }> }) {
  const { ruleId } = await props.params;
  if (!UUID.test(ruleId)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { data: rule } = await supabase.from("coach_learned_rules").select("id, status, from_name, to_name, preference_id, asked_for_program_id").eq("id", ruleId).eq("coach_id", user.id).maybeSingle();
  if (!rule) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const fail = () => NextResponse.json({ error: "That didn't save. Nothing was changed." }, { status: 500 });
  switch (body.action) {
    case "yes": {
      if (rule.status === "confirmed") return NextResponse.json({ ok: true });
      if (rule.status !== "suggested") return NextResponse.json({ error: "That one was already answered." }, { status: 409 });
      const p = preferenceFor({ from: rule.from_name, to: rule.to_name });
      const { data: pref, error } = await supabase
        .from("coach_program_preferences")
        .insert({ coach_id: user.id, condition_text: p.condition, preference_text: p.preference, source_program_id: rule.asked_for_program_id })
        .select("id")
        .single();
      if (error || !pref) return fail();
      const { error: e2 } = await supabase.from("coach_learned_rules").update({ status: "confirmed", preference_id: pref.id, decided_at: new Date().toISOString() }).eq("id", ruleId);
      if (e2) return fail();
      return NextResponse.json({ ok: true });
    }
    case "no": {
      if (rule.status !== "suggested") return NextResponse.json({ ok: true });
      const { error } = await supabase.from("coach_learned_rules").update({ status: "declined", decided_at: new Date().toISOString() }).eq("id", ruleId);
      return error ? fail() : NextResponse.json({ ok: true });
    }
    case "undo": {
      if (rule.preference_id) await supabase.from("coach_program_preferences").delete().eq("id", rule.preference_id);
      const { error } = await supabase.from("coach_learned_rules").update({ status: "undone", preference_id: null, decided_at: new Date().toISOString() }).eq("id", ruleId);
      return error ? fail() : NextResponse.json({ ok: true });
    }
    case "reason": {
      const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 600) : "";
      const ruleText = typeof body.ruleText === "string" ? body.ruleText.trim().slice(0, 300) : "";
      if (!reason || !ruleText) return NextResponse.json({ error: "Missing reason." }, { status: 400 });
      const { error } = await supabase.from("coach_learned_rules").update({ reason_text: reason, rule_text: ruleText }).eq("id", ruleId);
      if (error) return fail();
      // The saved line now says it in the coach's own terms (it still names both exercises), so the builder uses the reason too.
      if (rule.preference_id) await supabase.from("coach_program_preferences").update({ preference_text: ruleText }).eq("id", rule.preference_id);
      return NextResponse.json({ ok: true });
    }
    default:
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
}
