// AI Assistant Slice 2 (Collective Intelligence — The Briefing).
// Generalizes lib/pr-fatigue.ts's isEstablishingBaseline concept from a
// session count to a calendar-day window: "no trend claim before ~28
// days of that athlete's own baseline" (ai_assistant_opus_deep_dive_
// findings.md). A different unit than pr-fatigue's 2-prior-session gate
// (which is about one specific PR-detection signal), so this is a
// sibling function, not a shared abstraction forced across two genuinely
// different measurements.

export const BASELINE_WINDOW_DAYS = 28;

export function hasEstablishedBaseline(
  firstActivityAt: Date | null,
  now: Date,
  windowDays: number = BASELINE_WINDOW_DAYS
): boolean {
  if (!firstActivityAt) return false;
  const daysSince = Math.floor((now.getTime() - firstActivityAt.getTime()) / (1000 * 60 * 60 * 24));
  return daysSince >= windowDays;
}
