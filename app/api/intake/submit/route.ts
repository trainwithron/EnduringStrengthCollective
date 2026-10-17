import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { clientIp, rateLimitResponse } from "@/lib/rate-limit";
import { validateIntakeSubmission } from "@/lib/intake-submit";
import { loadDobGate } from "@/lib/dob-gate";
import { buildServerWaiverSnapshot, waiverVersionKey } from "@/lib/waiver-server";
import { recordLegalAcceptances } from "@/lib/legal-record";
import { screeningStatus, CLIENT_ALL_CLEAR_LINE, CLIENT_TALK_FIRST_LINE } from "@/lib/par-q-outcome";

// The health form and waiver are finished by this ONE server call. The browser can no longer mark its own intake complete: the time is the server's, the questions are ours, the address and device come from
// the request, and the record of exactly what was signed is built here. The row is written with the service role; a database rule (migration 0386) refuses the same columns from the browser.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Your session expired. Please sign in again." }, { status: 401 });

  const limited = await rateLimitResponse("intake-submit", user.id, 20, 3600);
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  const checked = validateIntakeSubmission(body);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });

  const groupId = typeof (body as { groupId?: unknown }).groupId === "string" ? (body as { groupId: string }).groupId : "";
  const { data: seat } = await supabase.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", user.id).maybeSingle();
  if (seat?.role !== "athlete") return NextResponse.json({ error: "That space was not found." }, { status: 404 });

  // A birthday first, and a child under 13 stops until a parent's consent is verified (the same rule as everywhere else).
  const facts = await loadDobGate(supabase, user.id);
  if (facts.gate !== "ok") return NextResponse.json({ error: "Add your date of birth first." }, { status: 409 });

  const db = createServiceRoleClient();
  const { data: existing } = await db.from("client_intake").select("completed_at").eq("athlete_id", user.id).maybeSingle();
  const status = screeningStatus(checked.answers);
  const line = status === "clear" ? CLIENT_ALL_CLEAR_LINE : CLIENT_TALK_FIRST_LINE;
  if (existing?.completed_at) return NextResponse.json({ ok: true, status, message: line, alreadyDone: true });

  const completedAt = new Date().toISOString();
  const written = await db
    .from("client_intake")
    .upsert(
      { athlete_id: user.id, group_id: groupId, par_q_answers: checked.answers, waiver_signed_name: checked.signedName, waiver_accepted: true, completed_at: completedAt },
      { onConflict: "athlete_id" }
    )
    .select("athlete_id");
  if (written.error || !written.data || written.data.length === 0) {
    return NextResponse.json({ error: "We couldn't save that. Check your connection and try again." }, { status: 500 });
  }

  // The record of what was signed. If this fails the intake is NOT left looking complete: it is rolled back so the client signs again rather than having a signature nobody can prove.
  const snapshot = await buildServerWaiverSnapshot(db, user.id);
  const ip = clientIp(request);
  const recorded = snapshot
    ? await recordLegalAcceptances(db, {
        profileId: user.id,
        documents: ["waiver"],
        ip: ip === "unknown" ? null : ip,
        userAgent: request.headers.get("user-agent"),
        snapshots: { waiver: snapshot },
        versions: { waiver: waiverVersionKey(snapshot) },
      })
    : false;
  if (!recorded) {
    await db.from("client_intake").update({ completed_at: null, waiver_accepted: false }).eq("athlete_id", user.id);
    return NextResponse.json({ error: "We couldn't save your signature. Please try again." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, status, message: line });
}
