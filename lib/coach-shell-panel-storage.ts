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
// Real feedback from Ron: the resize should go "effectively up to a
// full window," not stay capped at a narrow band. A static ceiling
// would either be too small on a big monitor or let the panel exceed a
// small one, so this is a generous fixed cap and the actual drag is
// additionally clamped against the live viewport width at drag time
// (shell-list-panel.tsx), always leaving room for the icon rail plus a
// sliver of main content.
export const MAX_LIST_PANEL_WIDTH = 1600;

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

// cascading_card_stack_widget_layering_idea.md — a second, switchable
// layout for the same real estate ShellListPanel occupies today: one
// floating, cascaded card stack showing 2-4 of the same four mini-views
// simultaneously instead of one-at-a-time tab switching. Per-coach,
// same guarded-localStorage convention as everything else in this file
// — no server round trip needed for a pure display preference.
export type LayoutMode = "traditional" | "card_stack";
const LAYOUT_MODE_KEY = "coach-shell-layout-mode";

export function readLayoutMode(): LayoutMode {
  try {
    return window.localStorage.getItem(LAYOUT_MODE_KEY) === "card_stack" ? "card_stack" : "traditional";
  } catch {
    return "traditional";
  }
}

export function writeLayoutMode(mode: LayoutMode): void {
  try {
    window.localStorage.setItem(LAYOUT_MODE_KEY, mode);
  } catch {
    // Non-fatal.
  }
}

// The card stack's own open/closed set AND front-to-back order in one
// array (index 0 = front-most). Defaults to all four open — per Ron's
// own mockup-refinement call ("whenever it populates, it would populate
// as open"), not collapsed-requiring-a-tap like the original mockup.
const CARD_STACK_ORDER_KEY = "coach-shell-card-stack-order";
const DEFAULT_CARD_STACK_ORDER: ListPanelView[] = ["roster", "business", "calendar", "program"];

export function readCardStackOrder(): ListPanelView[] {
  try {
    const raw = window.localStorage.getItem(CARD_STACK_ORDER_KEY);
    if (!raw) return DEFAULT_CARD_STACK_ORDER;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_CARD_STACK_ORDER;
    const deduped = Array.from(new Set(parsed)).filter((v): v is ListPanelView =>
      (VALID_VIEWS as string[]).includes(v)
    );
    return deduped;
  } catch {
    return DEFAULT_CARD_STACK_ORDER;
  }
}

export function writeCardStackOrder(order: ListPanelView[]): void {
  try {
    window.localStorage.setItem(CARD_STACK_ORDER_KEY, JSON.stringify(order));
  } catch {
    // Non-fatal.
  }
}

// Real feedback from Ron using the card-stack live: fixed cascade
// offsets weren't enough — cards need to be freely dragged and resized,
// "like we could do a custom window." Replaces the order-only model
// above with one entry per open card carrying its own x/y/width/height;
// array order is still front-to-back z-order (index 0 = front), same
// convention as the old `order` array, just carrying more per entry.
export interface CardStackEntry {
  view: ListPanelView;
  x: number;
  y: number;
  width: number;
  height: number;
}

const CARD_STACK_LAYOUT_KEY = "coach-shell-card-stack-layout";
export const CARD_STACK_DEFAULT_WIDTH = 340;
export const CARD_STACK_DEFAULT_HEIGHT = 560;
export const CARD_STACK_MIN_WIDTH = 260;
export const CARD_STACK_MIN_HEIGHT = 220;
const CASCADE_BASE = 16;
const CASCADE_STEP = 28;

function defaultCardStackLayout(order: ListPanelView[]): CardStackEntry[] {
  return order.map((view, i) => ({
    view,
    x: CASCADE_BASE + i * CASCADE_STEP,
    y: CASCADE_BASE + i * CASCADE_STEP,
    width: CARD_STACK_DEFAULT_WIDTH,
    height: CARD_STACK_DEFAULT_HEIGHT,
  }));
}

export function readCardStackLayout(): CardStackEntry[] {
  try {
    const raw = window.localStorage.getItem(CARD_STACK_LAYOUT_KEY);
    // No saved layout yet — migrate from the older order-only format
    // (or the default order for a brand-new coach) so an existing
    // open/closed set and z-order survives this upgrade.
    if (!raw) return defaultCardStackLayout(readCardStackOrder());

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaultCardStackLayout(readCardStackOrder());

    const seen = new Set<string>();
    const deduped: CardStackEntry[] = [];
    for (const entry of parsed) {
      if (
        entry &&
        typeof entry === "object" &&
        (VALID_VIEWS as string[]).includes(entry.view) &&
        !seen.has(entry.view)
      ) {
        seen.add(entry.view);
        deduped.push({
          view: entry.view,
          x: Number.isFinite(entry.x) ? entry.x : CASCADE_BASE,
          y: Number.isFinite(entry.y) ? entry.y : CASCADE_BASE,
          width: Number.isFinite(entry.width)
            ? Math.max(CARD_STACK_MIN_WIDTH, entry.width)
            : CARD_STACK_DEFAULT_WIDTH,
          height: Number.isFinite(entry.height)
            ? Math.max(CARD_STACK_MIN_HEIGHT, entry.height)
            : CARD_STACK_DEFAULT_HEIGHT,
        });
      }
    }
    return deduped;
  } catch {
    return defaultCardStackLayout(DEFAULT_CARD_STACK_ORDER);
  }
}

export function writeCardStackLayout(layout: CardStackEntry[]): void {
  try {
    window.localStorage.setItem(CARD_STACK_LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // Non-fatal.
  }
}

// overnight_comprehensive_polish_pass_sept19_20.md, finding #4 — the
// layout-mode toggle is a real, working feature hidden behind a bare,
// icon-only button with only a native browser tooltip. This tracks
// whether a coach has ever actually toggled it at least once, so a
// small "NEW" indicator can point at it until they have — same
// per-viewer, no-server-round-trip convention as everything else here.
const LAYOUT_MODE_TOGGLE_SEEN_KEY = "coach-shell-layout-mode-toggle-seen";

export function readHasSeenLayoutModeToggle(): boolean {
  try {
    return window.localStorage.getItem(LAYOUT_MODE_TOGGLE_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function markLayoutModeToggleSeen(): void {
  try {
    window.localStorage.setItem(LAYOUT_MODE_TOGGLE_SEEN_KEY, "1");
  } catch {
    // Non-fatal.
  }
}
