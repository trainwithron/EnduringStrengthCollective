// Ask Spot's floating-bubble position/dock state — a personal, per-browser
// UI preference (where a coach last dragged it, whether they swiped it
// docked), not data worth syncing across devices. Same read/write-with-
// fallback shape as lib/card-size.ts's localStorage wrapper.
export interface AskSpotWidgetState {
  side: "left" | "right";
  bottomOffsetPx: number;
  docked: boolean;
}

const STORAGE_KEY = "ask-spot-widget-state";

export const DEFAULT_ASK_SPOT_WIDGET_STATE: AskSpotWidgetState = {
  side: "right",
  bottomOffsetPx: 88,
  docked: false,
};

export function readAskSpotWidgetState(): AskSpotWidgetState {
  if (typeof window === "undefined") return DEFAULT_ASK_SPOT_WIDGET_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_ASK_SPOT_WIDGET_STATE;
    const parsed = JSON.parse(raw);
    if (
      (parsed.side === "left" || parsed.side === "right") &&
      typeof parsed.bottomOffsetPx === "number" &&
      typeof parsed.docked === "boolean"
    ) {
      return parsed;
    }
    return DEFAULT_ASK_SPOT_WIDGET_STATE;
  } catch {
    return DEFAULT_ASK_SPOT_WIDGET_STATE;
  }
}

export function writeAskSpotWidgetState(state: AskSpotWidgetState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private-browsing / storage-blocked — the widget still works for the
    // rest of this session, it just won't remember its spot next time.
  }
}
