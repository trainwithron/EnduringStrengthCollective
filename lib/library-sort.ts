// Sorting the exercise library by movement pattern, side and class (Ron: "sort by unilateral hinge, unilateral squat, lunge, overhead press, unilateral overhead press"). An exercise is tagged by
// being on one of the coach's pattern ladders: the pattern is the ladder, the class is its A / B / C mark, the side is its one-sided mark. Pure, so it is tested.
export type SideFilter = "all" | "bilateral" | "unilateral";
export type ClassFilter = "all" | "A" | "B" | "C";

export interface PatternTagged {
  pattern: string | null;
  unilateral: boolean;
  tier: "A" | "B" | "C" | null;
}

export interface LibraryFilters {
  pattern: string; // "all" or a pattern name
  side: SideFilter;
  tier: ClassFilter;
}

export const NO_FILTERS: LibraryFilters = { pattern: "all", side: "all", tier: "all" };

export function filtersActive(f: LibraryFilters): boolean {
  return f.pattern !== "all" || f.side !== "all" || f.tier !== "all";
}

// An exercise with no pattern never matches a pattern, side or class filter (it is simply not sorted yet).
export function matchesFilters(row: PatternTagged, f: LibraryFilters): boolean {
  if (!filtersActive(f)) return true;
  if (!row.pattern) return false;
  if (f.pattern !== "all" && row.pattern !== f.pattern) return false;
  if (f.side === "unilateral" && !row.unilateral) return false;
  if (f.side === "bilateral" && row.unilateral) return false;
  if (f.tier !== "all" && row.tier !== f.tier) return false;
  return true;
}

// The chips on a row: "Hinge · Unilateral · Class A".
export function tagChip(row: PatternTagged): string | null {
  if (!row.pattern) return null;
  const parts: string[] = [row.pattern, row.unilateral ? "Unilateral" : "Bilateral"];
  if (row.tier) parts.push(`Class ${row.tier}`);
  return parts.join(" · ");
}

// Which patterns the Pattern filter lists: every pattern the coach has, Ron's ten first in his order, then the extras and any of the coach's own.
export function patternFilterOptions(names: string[], order: string[]): string[] {
  const unique = [...new Set(names)];
  const ranked = (n: string) => {
    const i = order.indexOf(n);
    return i === -1 ? order.length : i;
  };
  return unique.sort((a, b) => ranked(a) - ranked(b) || a.localeCompare(b));
}
