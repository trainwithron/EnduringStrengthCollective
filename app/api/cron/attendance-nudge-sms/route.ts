import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { gatherCalendarSpotterFindings } from "@/lib/calendar-spotter-gather";
import { dispatchSms } from "@/lib/sms-dispatch";

// The Calendar Spotter's own "gap" finding (14+ days since a booked
// session was actually attended — lib/calendar-spotter.ts) turned into
// an outbound athlete-facing nudge. Reuses gatherCalendarSpotterFindings
// exactly as-is (the same function that already powers the coach-facing
// panel on calendar-spotter-panel.tsx) — this cron is just a second,
// headless consumer of the same findings, not a parallel detector.
//
// Deliberately scoped to "gap" only, not "flaky" or "recovery" — a gap
// is the one finding that's genuinely actionable as a re-engagement
// text ("come back"); "flaky" is a coach-facing pattern to discuss in
// person, not something to text at someone automatically, and
// "recovery" is good news with nothing to nudge about.
//
// No sms_log unique constraint enforces the "don't re-nudge too often"
// rule by itself here (a persistent 20-day gap and a 40-day gap are
// both still "gapped" every day the cron runs) — instead this checks
// for a prior attendance_nudge to the same athlete within the same
// window the gap detector itself uses (14 days) before sending another.
const RENUDGE_COOLDOWN_DAYS = 14;

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET isn't configured." }, { status: 503 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  const { data: groupRows } = await supabase
    .from("group_memberships")
    .select("group_id, profile_id, profiles ( full_name )")
    .eq("role", "coach");

  const coachByGroup = new Map<string, { coachId: string; coachName: string }>();
  for (const row of groupRows ?? []) {
    coachByGroup.set(row.group_id, {
      coachId: row.profile_id,
      coachName: (row as any).profiles?.full_name ?? "your coach",
    });
  }

  const cooldownSince = new Date(Date.now() - RENUDGE_COOLDOWN_DAYS * 86400000).toISOString();
  let checked = 0;
  let sent = 0;

  for (const [groupId, coach] of coachByGroup) {
    const findings = await gatherCalendarSpotterFindings(supabase, { groupId });
    const gaps = findings.filter((f) => f.kind === "gap");
    checked += gaps.length;

    for (const gap of gaps) {
      const { data: recentNudge } = await supabase
        .from("sms_log")
        .select("id")
        .eq("message_type", "attendance_nudge")
        .like("reference_id", `${gap.athleteId}:${groupId}:%`)
        .gte("sent_at", cooldownSince)
        .limit(1)
        .maybeSingle();
      if (recentNudge) continue;

      const { data: athleteDetails } = await supabase
        .from("athlete_profile_details")
        .select("phone")
        .eq("athlete_id", gap.athleteId)
        .maybeSingle();

      const todayKey = new Date().toISOString().slice(0, 10);
      const result = await dispatchSms(supabase, {
        coachId: coach.coachId,
        recipientPhone: athleteDetails?.phone,
        messageType: "attendance_nudge",
        referenceId: `${gap.athleteId}:${groupId}:${todayKey}`,
        body: `Hi ${gap.athleteName.split(" ")[0]}, it's been a couple weeks since your last session with ${coach.coachName} — hope you're doing well! Book your next one whenever you're ready.`,
      });
      if (result.sent) sent += 1;
    }
  }

  return NextResponse.json({ checked, sent });
}
