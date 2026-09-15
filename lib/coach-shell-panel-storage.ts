// Persists the coach-desktop-shell's list-panel width/collapsed state
// across sessions (coach_desktop_shell_identity_redesign.md, item 4 —
// "remembers the last width on expand... persists across sessions in a
// real build"). Same guarded-localStorage-wrapper shape as
// lib/card-size.ts and lib/rest-timer-storage.ts — the only existing
// precedent for this kind of per-viewer UI preference in this app.

const WIDTH_KEY = "coach-shell-list-panel-width";
const COLLAPSED_KEY = "coach-shell-list-panel-collapsed";
const VIEW_KEY = "coach-shell-list-panel-view";

export const DEFAULT_LIST_PANEL_WIDTH = 320;
export const MIN_LIST_PANEL_WIDTH = 220;
export const MAX_LIST_PANEL_WIDTH = 560;

export function readListPanelWidth(): number {
  try {
    const raw = window.localStorage.getItem(WIDTH_KEY);
    const parsed = raw ? parseInt(raw, 10) : NaN;
    if (Number.isFinite(parsed)) {
      return Math.min(MAX_LIST_PANEL_WIDTH, Math.max(MIN_LIST_PANEL_WIDTH, parsed));
    }
  } catch {
    // Storage unavailable — default width.
  }
  return DEFAULT_LIST_PANEL_WIDTH;
}

export function writeListPanelWidth(width: number): void {
  try {
    window.localStorage.setItem(WIDTH_KEY, String(Math.round(width)));
  } catch {
    // Non-fatal — the drag still works for this session.
  }
}

export function readListPanelCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeListPanelCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // Non-fatal.
  }
}

// calendar_workout_scheduling_and_adjustable_workspace_idea.md item 4 —
// extended from the original roster/business pair to let a coach pick
// what fills the panel more broadly, not just "roster vs. money."
export type ListPanelView = "roster" | "business" | "calendar" | "program";
const VALID_VIEWS: ListPanelView[] = ["roster", "business", "calendar", "program"];

export function readListPanelView(): ListPanelView {
  try {
    const raw = window.localStorage.getItem(VIEW_KEY);
    return (VALID_VIEWS as string[]).includes(raw ?? "") ? (raw as ListPanelView) : "roster";
  } catch {
    return "roster";
  }
}

export function writeListPanelView(view: ListPanelView): void {
  try {
    window.localStorage.setItem(VIEW_KEY, view);
  } catch {
    // Non-fatal.
  }
}
