import { createBrowserClient } from "@/lib/supabase/client";
import { notifyPush } from "@/lib/push-notify";

// gym_owner_multi_trainer_session_tracking_real_prospect.md's resolved
// three-tier staircase — "never miss a renewal moment," not a single
// low-balance ping. Fires to BOTH the group's own trainer (who has the
// actual resign conversation) and the organization's owner (roster-wide
// oversight) — Ron's own correction that this can't be a simple
// recipient swap. Deliberately keyed on the exact balance value at each
// call site (3 / 1 / 0) rather than a "crossed downward through"
// comparison requiring an old-balance round trip at every caller — the
// real cost of that simplicity is a small chance of a redundant repeat
// notification if a balance is nudged back to the same threshold twice
// in a row, which is a far safer failure mode than silently missing the
// real signal.
const TIER_MESSAGES: Record<number, { title: string; body: (name: string) => string }> = {
  3: {
    title: "Session package running low",
    body: (name) => `${name} has 3 sessions left — worth keeping an eye on for their next renewal.`,
  },
  1: {
    title: "One session left — renewal window",
    body: (name) => `${name} is down to their last session. This is the moment to start the renewal conversation.`,
  },
  0: {
    title: "Last session used — resign now",
    body: (name) => `${name} just used their final session. Start the renewal conversation now before they go quiet.`,
  },
};

// Re-reads the current balance itself rather than requiring every call
// site to thread a value through — deliberately decoupled from whichever
// RPC (book_session, adjust_session_credits, complete_workout_session)
// actually changed it, so a caller only needs to know "a credit was just
// spent here," not the resulting number.
export async function checkAndNotifyLowSessionBalance(athleteId: string, groupId: string): Promise<void> {
  const supabase = createBrowserClient();
  const { data: creditsRow } = await supabase
    .from("session_credits")
    .select("balance")
    .eq("athlete_id", athleteId)
    .eq("group_id", groupId)
    .maybeSingle();

  const balance = creditsRow?.balance;
  if (balance === undefined || balance === null) return;
  const tier = TIER_MESSAGES[balance];
  if (!tier) return;

  const [{ data: athleteProfile }, { data: coachRows }, { data: group }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", athleteId).maybeSingle(),
    supabase.from("group_memberships").select("profile_id").eq("group_id", groupId).eq("role", "coach"),
    supabase.from("groups").select("organization_id").eq("id", groupId).maybeSingle(),
  ]);

  const athleteName = athleteProfile?.full_name ?? "A client";
  const recipients = new Set<string>((coachRows ?? []).map((r) => r.profile_id));

  if (group?.organization_id) {
    const { data: ownerRows } = await supabase
      .from("organization_memberships")
      .select("profile_id")
      .eq("organization_id", group.organization_id)
      .eq("role", "owner");
    for (const row of ownerRows ?? []) recipients.add(row.profile_id);
  }

  const url = `/groups/${groupId}/athletes/${athleteId}`;
  for (const profileId of recipients) {
    notifyPush(profileId, tier.title, tier.body(athleteName), url);
  }

  // SMS mirror — a separate, opt-in channel each recipient (coach or
  // org owner) can turn on independently via their own coach_sms_config;
  // the route re-derives the tier and recipients itself rather than
  // trusting anything computed here, so this call only needs to say
  // which athlete/group changed.
  fetch("/api/sms/low-credit-alert", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ athleteId, groupId }),
  }).catch(() => {});
}
