// Exercise volume-history sparkline — total tonnage (weight x reps,
// summed per session, not per set) for one exercise across every prior
// session an athlete has logged it in. One point per session, ordered by
// that session's earliest completed-set timestamp. Pure, DOM-free, same
// "grouped from already-fetched rows" convention as
// lib/obstacle-unlock.ts's computePriorBest — no new query needed at any
// call site.

export interface VolumeHistorySetRow {
  sessionId: string;
  completedAt: string | null;
  weight: number | null;
  reps: number | null;
}

export interface VolumeHistoryPoint {
  sessionId: string;
  sessionDate: string;
  totalVolume: number;
}

// Below this many distinct sessions, a sparkline has nothing real to
// show a trend across — same "needs more data" floor already used
// elsewhere in this app's trend surfaces (e.g. TrendChart's own
// emptyLabel convention), just enforced by the caller before rendering
// rather than inside this pure function.
export const MIN_SESSIONS_FOR_HISTORY = 3;

export function computeVolumeHistory(rows: VolumeHistorySetRow[]): VolumeHistoryPoint[] {
  const bySession = new Map<string, { totalVolume: number; earliestDate: string | null }>();

  for (const row of rows) {
    // A set with no logged weight or reps contributes nothing countable
    // to tonnage — skipped rather than treated as zero, matching
    // computePriorBest's own null-handling for the same shape of data.
    if (row.weight == null || row.reps == null) continue;
    const entry = bySession.get(row.sessionId) ?? { totalVolume: 0, earliestDate: null };
    entry.totalVolume += row.weight * row.reps;
    if (row.completedAt && (!entry.earliestDate || row.completedAt < entry.earliestDate)) {
      entry.earliestDate = row.completedAt;
    }
    bySession.set(row.sessionId, entry);
  }

  return Array.from(bySession.entries())
    .map(([sessionId, { totalVolume, earliestDate }]) => ({
      sessionId,
      sessionDate: earliestDate ?? "",
      totalVolume,
    }))
    .sort((a, b) => a.sessionDate.localeCompare(b.sessionDate));
}
