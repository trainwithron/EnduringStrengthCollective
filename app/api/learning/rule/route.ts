import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { ALL_KEYS, labelFor } from "@/lib/clauses";
import { LEARN_INTRO, proposeRule, sameRule, withScope, type RuleScope } from "@/lib/learning-rule";
import { loadClientKeys } from "@/lib/learned-for-prompt";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KNOWN = new Set(ALL_KEYS.map((k) => k.key));

// "I'll remember..." after a correction. Everything is the coach's own (row policies). Two steps: PROPOSE reads the correction and says what would be remembered and for whom (nothing is saved); SAVE writes
// the rule once the coach says Yes (or changes who it applies to), and puts the clause on the client when the rule is for clients with that clause. The coach can turn the questions off; then nothing is
// proposed and nothing is asked, though nothing is lost either.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const action = typeof body.action === "string" ? body.action : "";
  const fail = () => NextResponse.json({ error: "That didn't save. Nothing was changed." }, { status: 500 });

  if (action === "intro_seen") {
    const { error } = await supabase.from("coach_learning_settings").upsert({ coach_id: user.id, intro_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    return error ? fail() : NextResponse.json({ ok: true });
  }

  const correction = typeof body.correction === "string" ? body.correction.slice(0, 300) : "";
  const groupId = typeof body.groupId === "string" && UUID.test(body.groupId) ? body.groupId : null;
  const athleteId = typeof body.athleteId === "string" && UUID.test(body.athleteId) ? body.athleteId : null;
  const whyText = typeof body.whyText === "string" ? body.whyText.slice(0, 600) : null;
  const whyChips: string[] = Array.isArray(body.whyChips) ? body.whyChips.filter((c: unknown): c is string => typeof c === "string").slice(0, 5) : [];
  if (!correction.trim()) return NextResponse.json({ error: "Missing correction." }, { status: 400 });

  // The client must be one of this coach's clients in a group the coach coaches.
  if (athleteId) {
    if (!groupId) return NextResponse.json({ error: "Missing group." }, { status: 400 });
    const [{ data: coachSeat }, { data: clientSeat }] = await Promise.all([
      supabase.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", user.id).maybeSingle(),
      supabase.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", athleteId).maybeSingle(),
    ]);
    if (coachSeat?.role !== "coach" || !clientSeat) return NextResponse.json({ error: "That client isn't yours." }, { status: 403 });
  }

  const { data: settings } = await supabase.from("coach_learning_settings").select("questions_enabled, intro_seen_at").eq("coach_id", user.id).maybeSingle();
  const askingOn = (settings as { questions_enabled?: boolean } | null)?.questions_enabled !== false;
  const introSeen = !!(settings as { intro_seen_at?: string | null } | null)?.intro_seen_at;

  const clientKeys = await loadClientKeys(supabase, user.id, athleteId);
  const proposal = proposeRule({ correction, whyText, whyChips, clientKeys });
  if (!proposal) return NextResponse.json({ skip: true });

  if (action === "propose") {
    if (!askingOn) return NextResponse.json({ skip: true });
    return NextResponse.json({
      proposal,
      whenLabels: proposal.whenKeys.map((k) => labelFor(k)),
      // The one-time explanation, then the reason question only when no reason could be read from the words or the client.
      intro: introSeen ? null : LEARN_INTRO,
      askWhy: proposal.whenKeys.length === 0 && !whyText && whyChips.length === 0,
    });
  }

  if (action === "save") {
    const scope: RuleScope | "client" | "all" | "clauses" = body.scope === "client" || body.scope === "all" || body.scope === "clauses" ? body.scope : proposal.scope;
    if (scope === "client" && !athleteId) return NextResponse.json({ error: "Pick the client." }, { status: 400 });
    // Reason tags picked by hand: known keys only, plus clauses the coach named (kept as their own words).
    const picked: string[] = Array.isArray(body.whenKeys) ? body.whenKeys.filter((k: unknown): k is string => typeof k === "string" && (KNOWN.has(k) || /^[a-z0-9_]{1,40}$/.test(k))).slice(0, 6) : [];
    const final = scope === "clauses" ? withScope(proposal, "clauses", picked.length > 0 ? picked : proposal.whenKeys) : scope === "client" ? { ...withScope(proposal, "client"), scope: "client" as RuleScope } : withScope(proposal, "all");

    const { data: existing } = await supabase
      .from("coach_learned_rules")
      .select("id, kind, then_text, when_keys, scope, client_id, confirmations")
      .eq("coach_id", user.id)
      .eq("status", "confirmed")
      .eq("kind", final.kind)
      .limit(100);
    const dup = ((existing ?? []) as { id: string; kind: string; then_text: string | null; when_keys: string[] | null; scope: string; client_id: string | null; confirmations: number }[]).find((r) =>
      sameRule(final, r, scope === "client" ? athleteId : null)
    );
    let ruleId: string | null = null;
    if (dup) {
      const { error } = await supabase.from("coach_learned_rules").update({ confirmations: dup.confirmations + 1 }).eq("id", dup.id);
      if (error) return fail();
      ruleId = dup.id;
    } else {
      const { data: rule, error } = await supabase
        .from("coach_learned_rules")
        .insert({
          coach_id: user.id,
          kind: final.kind,
          from_name: null,
          to_name: null,
          status: "confirmed",
          evidence_count: 1,
          evidence_total: 1,
          reason_text: whyText,
          rule_text: final.summary.replace(/^I'll remember: /, ""),
          then_text: final.thenText,
          when_keys: final.whenKeys,
          scope: final.scope,
          client_id: final.scope === "client" ? athleteId : null,
          source: typeof body.source === "string" ? body.source.slice(0, 30) : "pause_correction",
          confirmations: 1,
          decided_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (error || !rule) return fail();
      ruleId = rule.id;
    }

    // A rule for clients with a clause puts that clause on this client when they do not have it yet (the coach just told us they do).
    if (final.scope === "clauses" && athleteId && groupId) {
      const have = new Set(clientKeys);
      const toAdd = final.whenKeys.filter((k) => !have.has(k) && !k.startsWith("level_") && !k.startsWith("age_"));
      if (toAdd.length > 0) {
        await supabase.from("client_clauses").upsert(
          toAdd.map((k) => ({ coach_id: user.id, athlete_id: athleteId, group_id: groupId, key: k, label: labelFor(k) })),
          { onConflict: "coach_id,athlete_id,key", ignoreDuplicates: true }
        );
      }
    }
    // The correction and its context are kept as an event (best effort: the rule is already saved).
    if (body.programId && UUID.test(body.programId)) {
      await supabase.from("coach_edit_events").insert({
        coach_id: user.id,
        program_id: body.programId,
        kind: "correction",
        from_name: null,
        to_name: null,
        detail: { text: correction.slice(0, 300) },
        context: { clauses: clientKeys, scope: final.scope, when: final.whenKeys },
        why: whyText,
        reason_tags: whyChips,
        source: "pause_correction",
      });
    }
    if (!introSeen) await supabase.from("coach_learning_settings").upsert({ coach_id: user.id, intro_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    return NextResponse.json({ ok: true, ruleId, summary: final.summary });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
