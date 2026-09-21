import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendPushToProfile } from "@/lib/send-push";
import { isCreditBalanceExpired } from "@/lib/credit-expiration";

// acuity_replacement_gap_audit_sept16.md — credit-expiration window.
// Triggered daily by the Vercel Cron entry in vercel.json, same
// CRON_SECRET/service-role pattern as every other cron in this app.
// Only ever touches a balance where the coach has set a real
// credit_expiry_days (0 is the default for every existing coach and is
// never treated as "already expired" — see isCreditBalanceExpired).
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET isn't configured." }, { status: 503 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  const { data: creditRows } = await supabase
    .from("session_credits")
    .select("athlete_id, group_id, balance, last_granted_at")
    .gt("balance", 0)
    .not("last_granted_at", "is", null);

  if (!creditRows || creditRows.length === 0) {
    return NextResponse.json({ ok: true, expiredCount: 0 });
  }

  const groupIds = Array.from(new Set(creditRows.map((r) => r.group_id)));
  const { data: coachRows } = await supabase
    .from("group_memberships")
    .select("group_id, profile_id")
    .eq("role", "coach")
    .in("group_id", groupIds);
  const coachIdByGroup = new Map<string, string>();
  for (const row of coachRows ?? []) {
    if (!coachIdByGroup.has(row.group_id)) coachIdByGroup.set(row.group_id, row.profile_id);
  }

  const coachIds = Array.from(new Set(Array.from(coachIdByGroup.values())));
  const { data: policyRows } = await supabase
    .from("coach_booking_policies")
    .select("coach_id, credit_expiry_days")
    .in("coach_id", coachIds);
  const expiryDaysByCoach = new Map<string, number>();
  for (const row of policyRows ?? []) {
    expiryDaysByCoach.set(row.coach_id, row.credit_expiry_days);
  }

  const now = new Date();
  let expiredCount = 0;

  for (const row of creditRows) {
    const coachId = coachIdByGroup.get(row.group_id);
    const creditExpiryDays = coachId ? (expiryDaysByCoach.get(coachId) ?? 0) : 0;
    if (!isCreditBalanceExpired(row.last_granted_at, creditExpiryDays, now)) continue;

    const { error: updateError } = await supabase
      .from("session_credits")
      .update({ balance: 0, updated_at: now.toISOString() })
      .eq("athlete_id", row.athlete_id)
      .eq("group_id", row.group_id)
      .eq("balance", row.balance); // real optimistic guard against a concurrent grant/spend since this row was read
    if (updateError) continue;

    await supabase.from("session_credit_expirations").insert({
      athlete_id: row.athlete_id,
      group_id: row.group_id,
      credits_expired: row.balance,
    });

    const body = `${row.balance} unused session credit${row.balance === 1 ? "" : "s"} expired.`;
    await supabase.from("notifications").insert({
      profile_id: row.athlete_id,
      group_id: row.group_id,
      type: "credits_expired",
      body,
      link_path: `/groups/${row.group_id}/settings`,
    });
    await sendPushToProfile(supabase, row.athlete_id, "Session credits expired", body, `/groups/${row.group_id}/settings`);

    expiredCount++;
  }

  return NextResponse.json({ ok: true, expiredCount });
}
