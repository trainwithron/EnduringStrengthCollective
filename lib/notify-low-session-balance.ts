// gym_owner_multi_trainer_session_tracking_real_prospect.md's resolved
// three-tier staircase — "never miss a renewal moment," not a single
// low-balance ping: 3 left, 1 left, none left. Goes to BOTH the group's
// own trainer (who has the actual resign conversation) and the
// organization's owner (roster-wide oversight).
//
// The decision now lives on the server (/api/credits/low-balance-check):
// it re-reads the real balance, alerts once when a lower tier is first
// reached, and stays quiet until the balance has been topped up and has
// fallen again, so the same alert never repeats. Callers still only need to
// say "a session was just used here"; this never throws and never blocks.
export async function checkAndNotifyLowSessionBalance(athleteId: string, groupId: string): Promise<void> {
  try {
    const res = await fetch("/api/credits/low-balance-check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ athleteId, groupId }),
    });
    if (!res.ok) return;
    const data = await res.json().catch(() => ({}));
    if (data.notified === null || data.notified === undefined) return;

    // SMS mirror: a separate, opt-in channel each recipient (coach or org
    // owner) can turn on independently via their own coach_sms_config. Only
    // sent when the push side just crossed a tier, so a text never repeats
    // either.
    await fetch("/api/sms/low-credit-alert", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ athleteId, groupId }),
    }).catch(() => {});
  } catch {
    // Never blocks the session being logged.
  }
}
