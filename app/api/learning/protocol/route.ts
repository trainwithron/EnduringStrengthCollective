import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { labelFor, ruleApplies } from "@/lib/clauses";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// "Like Rob": what another of the coach's clients is programmed around, to use as a STARTING POINT for someone else. PREVIEW reads that client's clauses and the rules attached to them (clause names and
// rule sentences only, never notes, birthdays or medical text) from the coach's own rows. COPY puts the chosen clauses on the new client once (no link back: editing one never changes the other). Only the
// coach's own clients, and only inside one organization.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const action = typeof body.action === "string" ? body.action : "";
  const groupId = typeof body.groupId === "string" && UUID.test(body.groupId) ? body.groupId : null;
  const referenceId = typeof body.referenceClientId === "string" && UUID.test(body.referenceClientId) ? body.referenceClientId : null;
  if (!groupId || !referenceId) return NextResponse.json({ error: "Missing client." }, { status: 400 });

  const { data: seat } = await supabase.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", user.id).maybeSingle();
  if (seat?.role !== "coach") return NextResponse.json({ error: "Only the coach can do this." }, { status: 403 });

  // The organization the work is in; the reference client's clauses count only if they were written inside it.
  const { data: here } = await supabase.from("groups").select("organization_id").eq("id", groupId).maybeSingle();
  const orgId = (here as { organization_id?: string | null } | null)?.organization_id ?? null;
  const { data: refRows } = await supabase.from("client_clauses").select("key, label, group_id").eq("coach_id", user.id).eq("athlete_id", referenceId);
  const groupIds = [...new Set(((refRows ?? []) as { group_id: string }[]).map((r) => r.group_id))];
  const { data: orgRows } = groupIds.length > 0 ? await supabase.from("groups").select("id, organization_id").in("id", groupIds) : { data: [] as { id: string; organization_id: string | null }[] };
  const sameOrg = new Set(((orgRows ?? []) as { id: string; organization_id: string | null }[]).filter((g) => g.organization_id === orgId).map((g) => g.id));
  const clauses = ((refRows ?? []) as { key: string; label: string; group_id: string }[]).filter((r) => sameOrg.has(r.group_id));

  if (action === "preview") {
    const keys = clauses.map((c) => c.key);
    const { data: ruleRows } = await supabase
      .from("coach_learned_rules")
      .select("then_text, when_keys, scope, client_id")
      .eq("coach_id", user.id)
      .eq("status", "confirmed")
      .not("then_text", "is", null)
      .limit(200);
    const rules = ((ruleRows ?? []) as { then_text: string; when_keys: string[] | null; scope: string; client_id: string | null }[])
      .filter((r) => r.scope === "clauses" && ruleApplies({ scope: r.scope, whenKeys: r.when_keys, clientId: r.client_id }, { athleteId: referenceId, keys }))
      .map((r) => ({ text: r.then_text, clauseKeys: r.when_keys ?? [] }));
    const { data: ref } = await supabase.from("profiles").select("full_name").eq("id", referenceId).maybeSingle();
    return NextResponse.json({
      referenceName: ((ref as { full_name?: string | null } | null)?.full_name ?? "").trim().split(/\s+/)[0] || "that client",
      clauses: clauses.map((c) => ({ key: c.key, label: c.label || labelFor(c.key) })),
      rules,
    });
  }

  if (action === "copy") {
    const targetId = typeof body.targetClientId === "string" && UUID.test(body.targetClientId) ? body.targetClientId : null;
    const keys: string[] = Array.isArray(body.keys) ? body.keys.filter((k: unknown): k is string => typeof k === "string").slice(0, 12) : [];
    if (!targetId || keys.length === 0) return NextResponse.json({ error: "Missing client." }, { status: 400 });
    const { data: targetSeat } = await supabase.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", targetId).maybeSingle();
    if (!targetSeat) return NextResponse.json({ error: "That client isn't yours." }, { status: 403 });
    const chosen = clauses.filter((c) => keys.includes(c.key));
    if (chosen.length === 0) return NextResponse.json({ ok: true, added: 0 });
    const { error } = await supabase.from("client_clauses").upsert(
      chosen.map((c) => ({ coach_id: user.id, athlete_id: targetId, group_id: groupId, key: c.key, label: c.label })),
      { onConflict: "coach_id,athlete_id,key", ignoreDuplicates: true }
    );
    if (error) return NextResponse.json({ error: "That didn't save. Nothing was changed." }, { status: 500 });
    return NextResponse.json({ ok: true, added: chosen.length });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
