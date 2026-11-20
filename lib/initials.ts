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

// Look Refresh (Ron, Nov 20): each person's initials sit on a soft color of their own, the same one everywhere (from their id, so it never changes with a
// rename or the order of a list). Six tints, each a dark ground with a light letter of the same hue, every pair well over 4.5:1.
export const INITIALS_TINTS: readonly { bg: string; fg: string }[] = [
  { bg: "#2E3B52", fg: "#A9C8EE" },
  { bg: "#3B3322", fg: "#E8C98A" },
  { bg: "#233B30", fg: "#9ED6B5" },
  { bg: "#3F2A35", fg: "#E3A9C4" },
  { bg: "#33294A", fg: "#C3B2EC" },
  { bg: "#1F3A3A", fg: "#93D3CF" },
];

export function initialsTint(key: string): { bg: string; fg: string } {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return INITIALS_TINTS[(h >>> 0) % INITIALS_TINTS.length];
}
