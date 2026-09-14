// Shared "how recently did this client train" status-dot logic — was
// independently duplicated byte-for-byte across client-card-grid.tsx,
// roster-row.tsx, and home-client-card.tsx (one copy even carried a
// comment admitting it was "ported, not shared"). Extracted 2026-09-14
// during a codebase health audit; pure refactor, no behavior change.
export function daysSinceOf(lastWorkoutAt: string | null): number {
  if (!lastWorkoutAt) return Infinity;
  return Math.floor((Date.now() - new Date(lastWorkoutAt).getTime()) / (1000 * 60 * 60 * 24));
}

export function clientActivityStatus(lastWorkoutAt: string | null): { text: string; dotClass: string } {
  if (!lastWorkoutAt) {
    return { text: "No logs yet", dotClass: "bg-steel" };
  }
  const daysSince = daysSinceOf(lastWorkoutAt);
  if (daysSince === 0) return { text: "Logged today", dotClass: "bg-moss" };
  if (daysSince === 1) return { text: "Logged yesterday", dotClass: "bg-steel" };
  if (daysSince <= 3) return { text: `${daysSince} days quiet`, dotClass: "bg-steel" };
  return { text: `${daysSince} days quiet`, dotClass: "bg-rust" };
}
