import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { withCronRun } from "@/lib/cron-monitor";
import { pageAll } from "@/lib/page-all";
import { readRowsByIds } from "@/lib/read-by-ids";
import { getGroupCoachTimezone, nowInZone } from "@/lib/timezone";
import { sendCoachPush } from "@/lib/coach-notice";
import { dispatchSms } from "@/lib/sms-dispatch";
import { lowBalanceMessage } from "@/lib/low-balance-messages";
import { planLowSessionDigests, type LowCreditRow } from "@/lib/low-session-digest";

// Hourly. Running-low alerts (1 left, out) go out as ONE push per person per day, in the coach's morning (8:00 in the coach's own time zone), listing each client once at their lowest balance. They used to push the
// moment a session was marked, one push per client. A client is alerted once per tier until a top-up resets it (low_balance_alert_level, unchanged). "3 left" no longer pushes. The text-message mirror, when a coach
// has opted in, is sent from here too, one per client per tier. A coach's own switch for this kind (lib/coach-notice.ts) is checked in the one sender.
export const maxDuration = 120;

async function handler(request: Request) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "CRON_SECRET isn't configured." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const db = createServiceRoleClient();

  // A balance back above 3 resets the remembered tier, so the next fall alerts again.
  const reset = await db.from("session_credits").update({ low_balance_alert_level: null }).gt("balance", 3).not("low_balance_alert_level", "is", null);
  if (reset.error) return NextResponse.json({ error: "Could not reset the remembered tiers." }, { status: 500 });

  const { rows, failed } = await pageAll((from, to) =>
    db.from("session_credits").select("athlete_id, group_id, balance, low_balance_alert_level, payment_hold").lte("balance", 3).order("athlete_id").order("group_id").range(from, to)
  );
  if (failed) return NextResponse.json({ error: "Could not read the balances." }, { status: 500 });
  const credits: LowCreditRow[] = rows.map((r: any) => ({ athleteId: r.athlete_id, groupId: r.group_id, balance: r.balance, alertLevel: r.low_balance_alert_level ?? null, paymentHold: r.payment_hold === true }));
  if (credits.length === 0) return NextResponse.json({ pushes: 0, alerted: 0 });

  const groupIds = [...new Set(credits.map((c) => c.groupId))];
  const athleteIds = [...new Set(credits.map((c) => c.athleteId))];
  const [coaches, groups, seats, profiles] = await Promise.all([
    readRowsByIds(groupIds, (ids) => (from, to) => db.from("group_memberships").select("id, group_id, profile_id").eq("role", "coach").in("group_id", ids).order("id").range(from, to)),
    readRowsByIds(groupIds, (ids) => (from, to) => db.from("groups").select("id, organization_id").in("id", ids).order("id").range(from, to)),
    readRowsByIds(athleteIds, (ids) => (from, to) => db.from("group_memberships").select("id, group_id, profile_id, private_from_org").eq("role", "athlete").in("profile_id", ids).order("id").range(from, to)),
    readRowsByIds(athleteIds, (ids) => (from, to) => db.from("profiles").select("id, full_name").in("id", ids).order("id").range(from, to)),
  ]);
  if (coaches.error || groups.error || seats.error || profiles.error) return NextResponse.json({ error: "Could not read who to tell." }, { status: 500 });

  const orgIds = [...new Set(groups.data.map((g: any) => g.organization_id as string | null).filter((x): x is string => !!x))];
  const owners = await readRowsByIds(orgIds, (ids) => (from, to) => db.from("organization_memberships").select("id, organization_id, profile_id").eq("role", "owner").in("organization_id", ids).order("id").range(from, to));
  if (owners.error) return NextResponse.json({ error: "Could not read the owners." }, { status: 500 });

  const coachesByGroup = new Map<string, string[]>();
  for (const c of coaches.data) coachesByGroup.set(c.group_id, [...(coachesByGroup.get(c.group_id) ?? []), c.profile_id]);
  const orgOfGroup = new Map<string, string | null>(groups.data.map((g: any) => [g.id as string, (g.organization_id as string | null) ?? null]));
  const ownersByOrg = new Map<string, string[]>();
  for (const o of owners.data) ownersByOrg.set(o.organization_id, [...(ownersByOrg.get(o.organization_id) ?? []), o.profile_id]);
  const privateSeat = new Set(seats.data.filter((s: any) => s.private_from_org).map((s: any) => `${s.group_id}:${s.profile_id}`));
  const names = new Map<string, string>(profiles.data.map((p: any) => [p.id as string, (p.full_name as string) ?? "A client"]));

  // The hour it is for each group's coach, in the coach's own time zone.
  const hourByGroup = new Map<string, number>();
  for (const gid of groupIds) {
    try {
      hourByGroup.set(gid, nowInZone(await getGroupCoachTimezone(db, gid)).getUTCHours());
    } catch {
      hourByGroup.set(gid, -1);
    }
  }

  const plan = planLowSessionDigests({
    rows: credits,
    names,
    localHourForGroup: (gid) => hourByGroup.get(gid) ?? -1,
    recipientsByGroupAthlete: (gid, athleteId) => {
      const set = new Set<string>(coachesByGroup.get(gid) ?? []);
      const org = orgOfGroup.get(gid);
      // the organization's owner is not told about a client who is private from the organization
      if (org && !privateSeat.has(`${gid}:${athleteId}`)) for (const o of ownersByOrg.get(org) ?? []) set.add(o);
      return [...set];
    },
  });

  let sentPhones = 0;
  for (const p of plan.pushes) {
    sentPhones += await sendCoachPush(db, p.recipientId, "low_sessions", p.title, p.body, p.url).catch(() => 0);
  }

  // The text mirror (opt-in, each recipient's own number): one per client per tier, as before.
  for (const a of plan.alerted) {
    const body = lowBalanceMessage(a.tier, a.name, a.balance).body;
    for (const recipientId of a.recipients) {
      const { data: config } = await db.from("coach_sms_config").select("phone").eq("coach_id", recipientId).maybeSingle();
      await dispatchSms(db, {
        coachId: recipientId,
        recipientPhone: (config as { phone?: string | null } | null)?.phone,
        messageType: "low_credit_alert",
        referenceId: `${a.athleteId}:${a.groupId}:${a.balance}:${new Date().toISOString().slice(0, 10)}:${recipientId}`,
        body,
      }).catch(() => undefined);
    }
  }

  let updateFailures = 0;
  for (const u of plan.levelUpdates) {
    const { error } = await db.from("session_credits").update({ low_balance_alert_level: u.level }).eq("athlete_id", u.athleteId).eq("group_id", u.groupId);
    if (error) updateFailures += 1;
  }
  return NextResponse.json({ pushes: plan.pushes.length, phones: sentPhones, alerted: plan.alerted.length, updated: plan.levelUpdates.length, updateFailures }, { status: updateFailures > 0 ? 500 : 200 });
}

export const GET = withCronRun("low-session-digest", handler);
