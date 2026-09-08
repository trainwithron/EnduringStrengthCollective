// Shared small/medium/large card-density preference for the desktop card
// grids (Programs, Clients). Per-browser, per-grid — deliberately not
// synced to the database; it's a personal viewing preference, not data
// other coaches in the org would need to see.
export type CardSize = "small" | "medium" | "large";

export const CARD_SIZE_LABELS: Record<CardSize, string> = {
  small: "S",
  medium: "M",
  large: "L",
};

export function readCardSize(storageKey: string, fallback: CardSize = "medium"): CardSize {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(storageKey);
    return stored === "small" || stored === "medium" || stored === "large" ? stored : fallback;
  } catch {
    return fallback;
  }
}

export function writeCardSize(storageKey: string, size: CardSize): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, size);
  } catch {
    // Private-browsing / storage-blocked — the toggle still works for
    // the rest of this session, it just won't persist across reloads.
  }
}
