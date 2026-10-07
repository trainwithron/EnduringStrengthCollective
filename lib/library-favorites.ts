// What a client keeps coming back to: a meal they starred, or one they logged as eaten at least three times in the last four weeks. The builder puts these first and lets them
// repeat through the week. "I ate this" logs a name, not a recipe id, so an eaten meal is matched by its name.

export const FAVORITE_EATEN_TIMES = 3;
export const FAVORITE_WINDOW_DAYS = 28;

export interface FavoriteSignals {
  // Recipe ids a client starred (a starter-library template id, or a coach recipe id).
  ids: string[];
  // Names, normalised: starred foods by label and meals eaten three or more times.
  names: string[];
}

export const normalizeName = (s: string): string => s.toLowerCase().replace(/<[^>]+>/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

export function favoriteSignals(args: {
  stars: { recipeId: string | null; kind: string | null; label: string | null }[];
  eaten: { description: string | null; logDate: string }[];
  todayKey: string;
}): FavoriteSignals {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const s of args.stars) {
    if (s.kind === "food") {
      const n = s.label ? normalizeName(s.label) : "";
      if (n) names.add(n);
    } else if (s.recipeId) {
      ids.add(s.recipeId);
    }
  }
  // Only date keys inside the window count (a key is the client's own calendar day, so no time zone moves one across the edge).
  const today = new Date(`${args.todayKey}T00:00:00Z`).getTime();
  const counts = new Map<string, number>();
  for (const e of args.eaten) {
    const n = e.description ? normalizeName(e.description) : "";
    if (!n) continue;
    const days = (today - new Date(`${e.logDate}T00:00:00Z`).getTime()) / 86_400_000;
    if (!(days >= 0 && days < FAVORITE_WINDOW_DAYS)) continue;
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  for (const [n, c] of counts) if (c >= FAVORITE_EATEN_TIMES) names.add(n);
  return { ids: [...ids], names: [...names] };
}
