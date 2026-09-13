// AI Assistant Slice 2 — "the same signal/athlete pair can't resurface
// for a week after being shown" (ai_assistant_opus_deep_dive_findings.md).
// A signal id already encodes exactly what it's about (e.g.
// "matched_load_trend::{athleteId}::Bench Press",
// "quiet_client::{athleteId}") — cooldown is just "was this exact id
// already cited in an item shown within the last N days," no separate
// kind-matching layer needed.

export const COOLDOWN_DAYS = 7;

export function isOnCooldown(
  candidateSignalId: string,
  priorShownSignalIds: { signalId: string; shownAt: Date }[],
  now: Date,
  cooldownDays: number = COOLDOWN_DAYS
): boolean {
  const cutoff = now.getTime() - cooldownDays * 24 * 60 * 60 * 1000;
  return priorShownSignalIds.some(
    (p) => p.signalId === candidateSignalId && p.shownAt.getTime() > cutoff
  );
}
