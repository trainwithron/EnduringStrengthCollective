import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getCallerGroupRole } from "@/lib/group-access";
import { rateLimitResponse } from "@/lib/rate-limit";
import { sendPushToProfile } from "@/lib/send-push";
import { lowBalanceCrossing, tierForBalance } from "@/lib/reup";
import { lowBalanceMessage } from "@/lib/low-balance-messages";

// Called right after a session is used. Re-reads the real balance and, when it has just crossed into a lower low-balance tier
// (3 left, 1 left, none left), tells the group's coach and the organization's owner once. It does not repeat until the balance
// has been topped up and has fallen again. If the dedupe column (migration 0260) is not there yet it falls back to the older
// behavior: alert on an exact 3, 1 or 0.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const athleteId = typeof body.athleteId === "string" ? body.athleteId : null;
  const groupId = typeof body.groupId === "string" ? body.groupId : null;
  if (!athleteId || !groupId) return NextResponse.json({ error: "Missing athleteId or groupId." }, { status: 400 });

  const limited = await rateLimitResponse("low-balance-check", user.id, 120, 3600);
  if (limited) return limited;

  // Only the client themselves (their own balance just changed) or a coach of the group, and the client must be in the group.
  const role = await getCallerGroupRole(supabase, user.id, groupId);
  if (!role || (role === "athlete" && user.id !== athleteId)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });

  const db = createServiceRoleClient();
  const { data: member } = await db
    .from("group_memberships")
    .select("profile_id")
    .eq("group_id", groupId)
    .eq("profile_id", athleteId)
    .eq("role", "athlete")
    .maybeSingle();
  if (!member) return NextResponse.json({ error: "Not allowed." }, { status: 403 });

  let dedupe = true;
  type CreditsRow = { balance: number; low_balance_alert_level?: number | null; payment_hold?: boolean | null };
  let row: CreditsRow | null = null;
  const first = await db
    .from("session_credits")
    .select("balance, low_balance_alert_level, payment_hold")
    .eq("athlete_id", athleteId)
    .eq("group_id", groupId)
    .maybeSingle();
  if (first.error) {
    dedupe = false;
    const legacy = await db.from("session_credits").select("balance").eq("athlete_id", athleteId).eq("group_id", groupId).maybeSingle();
    row = legacy.data as CreditsRow | null;
  } else {
    row = first.data as CreditsRow | null;
  }
  if (!row) return NextResponse.json({ notified: null });
  // A client the coach has put on hold (comped, on a break, pays another way) is never alerted about.
  if (row.payment_hold) return NextResponse.json({ notified: null });

  const balance = row.balance;
  let tier: 3 | 1 | 0 | null;
  if (dedupe) {
    const crossing = lowBalanceCrossing(balance, row.low_balance_alert_level ?? null);
    tier = crossing.notify;
    if (crossing.nextLevel !== (row.low_balance_alert_level ?? null)) {
      await db.from("session_credits").update({ low_balance_alert_level: crossing.nextLevel }).eq("athlete_id", athleteId).eq("group_id", groupId);
    }
  } else {
    tier = balance === 3 ? 3 : balance === 1 ? 1 : balance === 0 ? 0 : null;
  }
  if (tier === null || tierForBalance(balance) === null) return NextResponse.json({ notified: null });

  const [{ data: athleteProfile }, { data: coachRows }, { data: group }] = await Promise.all([
    db.from("profiles").select("full_name").eq("id", athleteId).maybeSingle(),
    db.from("group_memberships").select("profile_id").eq("group_id", groupId).eq("role", "coach"),
    db.from("groups").select("organization_id").eq("id", groupId).maybeSingle(),
  ]);
  const recipients = new Set<string>((coachRows ?? []).map((r: any) => r.profile_id as string));
  if (group?.organization_id) {
    const { data: ownerRows } = await db
      .from("organization_memberships")
      .select("profile_id")
      .eq("organization_id", group.organization_id)
      .eq("role", "owner");
    for (const r of ownerRows ?? []) recipients.add((r as any).profile_id as string);
  }

  const { title, body: text } = lowBalanceMessage(tier, athleteProfile?.full_name ?? "A client", balance);
  const url = `/groups/${groupId}/athletes/${athleteId}`;
  let sent = 0;
  for (const profileId of recipients) {
    sent += await sendPushToProfile(db, profileId, title, text, url).catch(() => 0);
  }
  return NextResponse.json({ notified: tier, sent });
}
