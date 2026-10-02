// Edge-tab position — a personal, per-browser UI preference (which edge,
// and where along it a coach last dragged the tab), not data worth
// syncing across devices. Same read/write-with-fallback shape as
// lib/card-size.ts's localStorage wrapper, and the same
// caller-supplies-its-own-key convention — desktop's Ask Spot tab
// (collective-intelligence-chat.tsx) and mobile's "More" drawer
// (coach-more-drawer.tsx) each persist their own edge position under
// their own key rather than sharing one, even though both reuse this
// same read/write logic.
export interface AskSpotWidgetState {
  side: "left" | "right";
  bottomOffsetPx: number;
}

export const DEFAULT_ASK_SPOT_WIDGET_STATE: AskSpotWidgetState = {
  side: "right",
  bottomOffsetPx: 88,
};

export function readAskSpotWidgetState(storageKey: string): AskSpotWidgetState {
  if (typeof window === "undefined") return DEFAULT_ASK_SPOT_WIDGET_STATE;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return DEFAULT_ASK_SPOT_WIDGET_STATE;
    const parsed = JSON.parse(raw);
    if ((parsed.side === "left" || parsed.side === "right") && typeof parsed.bottomOffsetPx === "number") {
      return { side: parsed.side, bottomOffsetPx: parsed.bottomOffsetPx };
    }
    return DEFAULT_ASK_SPOT_WIDGET_STATE;
  } catch {
    return DEFAULT_ASK_SPOT_WIDGET_STATE;
  }
}

export function writeAskSpotWidgetState(storageKey: string, state: AskSpotWidgetState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // Private-browsing / storage-blocked — the widget still works for the
    // rest of this session, it just won't remember its spot next time.
  }
}
