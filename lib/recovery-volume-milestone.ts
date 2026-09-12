// Milestone Celebrations, piece B (milestone_celebration_system_scoping.md)
// — "recovering better while lifting heavier." Structurally the SAME
// dual-trend-correlation engine as the reverse-diet flagship
// (lib/metabolic-trend.ts's computeWindowedAverage, first-half-vs-
// second-half comparison) — just a different pair of series and a
// different qualifying shape (both series improving/holding, not one up
// one down). No coach opt-in tag needed here, unlike the flagship: there
// is no equivalent false-positive risk to guard against — lifting more
// while genuinely recovering better is unambiguously a good pattern
// regardless of whether a coach specifically programmed for it.

import { computeWindowedAverage, type DateValueRow } from "./metabolic-trend";

export interface RecoveryVolumeMilestoneResult {
  qualifies: boolean;
  readinessChangePct: number; // second-half avg vs first-half avg readiness
  volumeChangePct: number; // second-half avg per-session volume vs first-half
}

// readinessRows: one row per day with a wellness check-in (the daily
// readiness average, 1-5 scale). volumeRows: one row per completed
// workout, dated, with that session's total_volume.
export function computeRecoveryVolumeMilestone(
  readinessRows: DateValueRow[],
  volumeRows: DateValueRow[],
  asOf: Date,
  windowWeeks = 4,
  readinessMinChangePct = -5, // holding steady (small noise tolerance) or improving
  volumeMinChangePct = 10 // a real increase, not noise
): RecoveryVolumeMilestoneResult | null {
  const windowStart = new Date(asOf);
  windowStart.setDate(windowStart.getDate() - windowWeeks * 7 + 1);
  const halfwayMs = (asOf.getTime() - windowStart.getTime()) / 2;
  const firstHalfEnd = new Date(windowStart.getTime() + halfwayMs);
  const secondHalfStart = new Date(firstHalfEnd.getTime() + 24 * 60 * 60 * 1000);

  const firstHalfReadiness = computeWindowedAverage(readinessRows, windowStart, firstHalfEnd);
  const secondHalfReadiness = computeWindowedAverage(readinessRows, secondHalfStart, asOf);
  // Volume only logs on training days, so a much lower coverage bar than
  // readiness (which can be logged daily) — otherwise a normal 3-4x/week
  // training split would never clear the default 50% minimum.
  const firstHalfVolume = computeWindowedAverage(volumeRows, windowStart, firstHalfEnd, 0.15);
  const secondHalfVolume = computeWindowedAverage(volumeRows, secondHalfStart, asOf, 0.15);

  if (
    firstHalfReadiness == null ||
    secondHalfReadiness == null ||
    firstHalfVolume == null ||
    secondHalfVolume == null ||
    firstHalfReadiness === 0 ||
    firstHalfVolume === 0
  ) {
    return null;
  }

  const readinessChangePct =
    Math.round(((secondHalfReadiness - firstHalfReadiness) / firstHalfReadiness) * 1000) / 10;
  const volumeChangePct =
    Math.round(((secondHalfVolume - firstHalfVolume) / firstHalfVolume) * 1000) / 10;

  const qualifies = readinessChangePct >= readinessMinChangePct && volumeChangePct >= volumeMinChangePct;

  return { qualifies, readinessChangePct, volumeChangePct };
}
