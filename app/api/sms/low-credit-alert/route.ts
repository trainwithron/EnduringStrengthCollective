import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { dispatchSms } from "@/lib/sms-dispatch";

// SMS mirror of lib/notify-low-session-balance.ts's existing push
// alert — same tier thresholds (3/1/0), same recipients (the group's
// coach(es) + the org owner), same "re-read the real balance rather
// than trust a caller-supplied value" defensiveness. Each recipient's
// own coach_sms_config gates and receives this independently — the
// coach and the org owner can each opt in/out and use their own phone
// number, they aren't a single shared "business" config.
const TIER_MESSAGES: Record<number, (name: string) => string> = {
  3: (name) => `${name} has 3 sessions left — worth a renewal check-in soon.`,
  1: (name) => `${name} is down to their last session. Good time to start the renewal conversation.`,
  0: (name) => `${name} just used their final session. Start the renewal conversation now.`,
};

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { athleteId, groupId } = await request.json();
  if (!athleteId || !groupId) {
    return NextResponse.json({ error: "Missing athleteId or groupId." }, { status: 400 });
  }

  const serviceRole = createServiceRoleClient();

  const { data: creditsRow } = await serviceRole
    .from("session_credits")
    .select("balance")
    .eq("athlete_id", athleteId)
    .eq("group_id", groupId)
    .maybeSingle();

  const balance = creditsRow?.balance;
  const messageFor = balance !== undefined && balance !== null ? TIER_MESSAGES[balance] : undefined;
  if (!messageFor) return NextResponse.json({ sent: false, reason: "no_tier_match" });

  const [{ data: athleteProfile }, { data: coachRows }, { data: group }] = await Promise.all([
    serviceRole.from("profiles").select("full_name").eq("id", athleteId).maybeSingle(),
    serviceRole.from("group_memberships").select("profile_id").eq("group_id", groupId).eq("role", "coach"),
    serviceRole.from("groups").select("organization_id").eq("id", groupId).maybeSingle(),
  ]);

  const athleteName = athleteProfile?.full_name ?? "A client";
  const recipients = new Set<string>((coachRows ?? []).map((r) => r.profile_id));

  if (group?.organization_id) {
    const { data: ownerRows } = await serviceRole
      .from("organization_memberships")
      .select("profile_id")
      .eq("organization_id", group.organization_id)
      .eq("role", "owner");
    for (const row of ownerRows ?? []) recipients.add(row.profile_id);
  }

  const todayKey = new Date().toISOString().slice(0, 10);
  const body = messageFor(athleteName);
  const results = [];
  for (const recipientId of recipients) {
    const { data: config } = await serviceRole
      .from("coach_sms_config")
      .select("phone")
      .eq("coach_id", recipientId)
      .maybeSingle();
    const result = await dispatchSms(serviceRole, {
      coachId: recipientId,
      recipientPhone: config?.phone,
      messageType: "low_credit_alert",
      referenceId: `${athleteId}:${groupId}:${balance}:${todayKey}:${recipientId}`,
      body,
    });
    results.push({ recipientId, ...result });
  }

  return NextResponse.json({ results });
}
