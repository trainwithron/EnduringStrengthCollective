import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendPushToProfile } from "@/lib/send-push";
import { isCreditBalanceExpired, creditToExpire } from "@/lib/credit-expiration";
import { fetchBookingCountsOrNull } from "@/lib/credit-picture";
import { withCronRun } from "@/lib/cron-monitor";

// acuity_replacement_gap_audit_sept16.md — credit-expiration window.
// Triggered daily by the Vercel Cron entry in vercel.json, same
// CRON_SECRET/service-role pattern as every other cron in this app.
// Only ever touches a balance where the coach has set a real
// credit_expiry_days (0 is the default for every existing coach and is
// never treated as "already expired" — see isCreditBalanceExpired).
async function handler(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET isn't configured." }, { status: 503 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  // A coach can hold expiry for one client (migration 0280); before that update the column does not exist and the job reads without it.
  let creditResult = await supabase
    .from("session_credits")
    .select("athlete_id, group_id, balance, last_granted_at, expiry_hold_until")
    .gt("balance", 0)
    .not("last_granted_at", "is", null);
  if (creditResult.error) {
    creditResult = (await supabase
      .from("session_credits")
      .select("athlete_id, group_id, balance, last_granted_at")
      .gt("balance", 0)
      .not("last_granted_at", "is", null)) as typeof creditResult;
  }
  const creditRows = creditResult.data as
    | { athlete_id: string; group_id: string; balance: number; last_granted_at: string | null; expiry_hold_until?: string | null }[]
    | null;

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
  let skippedUnreadable = 0;

  for (const row of creditRows) {
    const coachId = coachIdByGroup.get(row.group_id);
    const creditExpiryDays = coachId ? (expiryDaysByCoach.get(coachId) ?? 0) : 0;
    if (row.expiry_hold_until && new Date(row.expiry_hold_until).getTime() > now.getTime()) continue;
    if (!isCreditBalanceExpired(row.last_granted_at, creditExpiryDays, now)) continue;

    // Only what is truly unused expires: sessions already booked ahead, and sessions that happened but are not marked yet, will still take one each. If the
    // bookings cannot be read, nothing is expired for this client tonight (the job never guesses).
    const counts = await fetchBookingCountsOrNull(supabase, { athleteId: row.athlete_id, groupId: row.group_id }, now);
    if (!counts) {
      skippedUnreadable++;
      continue;
    }
    const mine = counts.get(`${row.athlete_id}:${row.group_id}`);
    const amount = creditToExpire(row.balance, mine?.booked ?? 0, mine?.toMark ?? 0);
    if (amount <= 0) continue;

    // One locked step on the database: the balance, the ledger row and the expiry record together, and only if the balance is still what was read above.
    const { data: expired, error: expireError } = await supabase.rpc("expire_session_credit_balance", {
      p_athlete_id: row.athlete_id,
      p_group_id: row.group_id,
      p_amount: amount,
      p_expected_balance: row.balance,
    });
    if (expireError || expired !== true) continue;

    const body = `${amount} unused session${amount === 1 ? "" : "s"} expired.`;
    await supabase.from("notifications").insert({
      profile_id: row.athlete_id,
      group_id: row.group_id,
      type: "credits_expired",
      body,
      link_path: `/groups/${row.group_id}/settings`,
    });
    await sendPushToProfile(supabase, row.athlete_id, "Sessions expired", body, `/groups/${row.group_id}/settings`);

    expiredCount++;
  }

  return NextResponse.json({ ok: true, expiredCount, skippedUnreadable });
}

export const GET = withCronRun("expire-session-credits", handler);
