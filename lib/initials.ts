// Name-to-initials for a small round avatar fallback — was duplicated
// byte-for-byte across client-card-grid.tsx, home-client-card.tsx, and
// roster-mini-list.tsx. Extracted 2026-09-14 during a codebase health
// audit; pure refactor, no behavior change.
export function initialsOf(name: string): string {
  return name
    .split(" ")
    .map((p) => Array.from(p)[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
