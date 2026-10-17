import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { clientIp, rateLimitResponse } from "@/lib/rate-limit";
import { validateIntakeSubmission } from "@/lib/intake-submit";
import { loadDobGate } from "@/lib/dob-gate";
import { buildServerWaiverSnapshot, waiverVersionKey } from "@/lib/waiver-server";
import { recordLegalAcceptances } from "@/lib/legal-record";
import { finishIntake } from "@/lib/intake-finish";
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

  // The record of what was signed comes FIRST, and the form is marked complete only once that record exists (lib/intake-finish.ts). The record is built from the name, time and group being signed right now:
  // the intake row does not hold them yet. If the record cannot be saved nothing was marked complete, so there is nothing to undo.
  const ip = clientIp(request);
  const finished = await finishIntake(
    { groupId, signedName: checked.signedName, now: new Date() },
    {
      buildSnapshot: (signing) => buildServerWaiverSnapshot(db, user.id, signing),
      record: (snapshot) =>
        recordLegalAcceptances(db, {
          profileId: user.id,
          documents: ["waiver"],
          ip: ip === "unknown" ? null : ip,
          userAgent: request.headers.get("user-agent"),
          snapshots: { waiver: snapshot },
          versions: { waiver: waiverVersionKey(snapshot) },
        }),
      writeComplete: async (completedAtIso) => {
        const written = await db
          .from("client_intake")
          .upsert(
            { athlete_id: user.id, group_id: groupId, par_q_answers: checked.answers, waiver_signed_name: checked.signedName, waiver_accepted: true, completed_at: completedAtIso },
            { onConflict: "athlete_id" }
          )
          .select("athlete_id");
        return !written.error && !!written.data && written.data.length > 0;
      },
    }
  );
  if (!finished.ok) {
    return NextResponse.json(
      { error: finished.step === "record" ? "We couldn't save your signature. Please try again." : "We couldn't save that. Check your connection and try again." },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true, status, message: line });
}
