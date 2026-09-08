// Pure date/scoring math behind Social Media Challenges — kept separate
// from data-fetching so the "which day is this challenge on" and
// "who's winning" logic is directly testable.

export interface ChallengeWindow {
  daysElapsed: number; // 0 on day 1, clamped to [0, totalDays]
  totalDays: number;
  hasStarted: boolean;
  hasEnded: boolean;
}

export function computeChallengeWindow(
  startDateKey: string,
  durationWeeks: number,
  todayKey: string
): ChallengeWindow {
  const start = new Date(`${startDateKey}T00:00:00`);
  const today = new Date(`${todayKey}T00:00:00`);
  const totalDays = durationWeeks * 7;
  const rawElapsed = Math.floor((today.getTime() - start.getTime()) / 86400000);
  return {
    daysElapsed: Math.min(Math.max(rawElapsed, 0), totalDays),
    totalDays,
    hasStarted: rawElapsed >= 0,
    hasEnded: rawElapsed >= totalDays,
  };
}

// Consistency % = completed check-offs / (habit count * days-in-window-so-far).
// Day 1 counts as 1 possible day per habit, not 0.
export function computeConsistencyPct(
  completedCount: number,
  habitCount: number,
  daysElapsed: number
): number {
  const possibleDays = daysElapsed + 1;
  const possible = habitCount * possibleDays;
  if (possible <= 0) return 0;
  return Math.round((completedCount / possible) * 100);
}

// Ranking itself is generic — shared with per-group leaderboards.
export { rankLeaderboard, type LeaderboardEntry } from "./leaderboard";

export function estimatedRevenueCents(participantCount: number, entryFeeCents: number): number {
  return participantCount * entryFeeCents;
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
