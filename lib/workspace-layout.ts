import { isAllowedWorkspacePath, pushRecent, type WorkspaceDestination } from "@/lib/workspace-destinations";

// The unified workspace's layout: ONE docked panel beside the page (its panes are tabs) plus any number of floating cards, each showing one destination
// (lib/workspace-destinations.ts). Pure state and rules, no screen: the shell stores it per coach in this browser, and every change goes through `reduce`, so
// the rules below (limits, no duplicates, nothing off-screen, a saved layout that is wrong is repaired) hold everywhere and are tested.

export const LAYOUT_VERSION = 1;
export const MAX_DOCK_PANES = 6;
export const MAX_FLOATING = 6;
export const DOCK_MIN_WIDTH = 300;
export const DOCK_MAX_WIDTH = 1100;
export const DOCK_DEFAULT_WIDTH = 420;
export const FLOAT_MIN_WIDTH = 320;
export const FLOAT_MIN_HEIGHT = 220;
export const FLOAT_DEFAULT_WIDTH = 460;
export const FLOAT_DEFAULT_HEIGHT = 520;
// Below this window width there is no room to float a card beside the page, so every pane lives in the dock (the saved layout is kept and comes back on a wider window).
export const MIN_VIEWPORT_FOR_FLOATING = 1366;

export interface PaneState {
  id: string;
  dest: WorkspaceDestination;
}
export interface FloatingPane extends PaneState {
  x: number;
  y: number;
  w: number;
  h: number;
  minimized: boolean;
}
export interface WorkspaceLayout {
  version: number;
  dock: { open: boolean; width: number; panes: PaneState[]; activeId: string | null };
  // Back to front: the last one is on top.
  floating: FloatingPane[];
  recents: WorkspaceDestination[];
}

export const EMPTY_LAYOUT: WorkspaceLayout = {
  version: LAYOUT_VERSION,
  dock: { open: false, width: DOCK_DEFAULT_WIDTH, panes: [], activeId: null },
  floating: [],
  recents: [],
};

export interface Bounds {
  width: number;
  height: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

export type WorkspaceAction =
  | { type: "open"; id: string; dest: WorkspaceDestination; where: "dock" | "floating"; bounds?: Bounds }
  | { type: "close"; id: string }
  | { type: "activate"; id: string }
  | { type: "setDockOpen"; open: boolean }
  | { type: "setDockWidth"; width: number }
  | { type: "move"; id: string; x: number; y: number; bounds: Bounds }
  | { type: "resize"; id: string; w: number; h: number; bounds: Bounds }
  | { type: "minimize"; id: string; minimized: boolean }
  | { type: "raise"; id: string }
  | { type: "toDock"; id: string }
  | { type: "toFloating"; id: string; bounds: Bounds }
  | { type: "reorderDock"; id: string; toIndex: number }
  | { type: "clearRecents" }
  | { type: "replace"; layout: WorkspaceLayout };

const sameDest = (a: WorkspaceDestination, b: WorkspaceDestination) => a.id === b.id;

// Where a new card starts: stepped down and right from the last one, kept inside the window.
function cascade(floating: FloatingPane[], bounds?: Bounds): { x: number; y: number } {
  const n = floating.length;
  const x = 24 + (n % 6) * 28;
  const y = 24 + (n % 6) * 28;
  if (!bounds) return { x, y };
  return { x: clamp(x, 0, Math.max(0, bounds.width - FLOAT_DEFAULT_WIDTH)), y: clamp(y, 0, Math.max(0, bounds.height - FLOAT_DEFAULT_HEIGHT)) };
}

export function reduce(state: WorkspaceLayout, action: WorkspaceAction): WorkspaceLayout {
  switch (action.type) {
    case "open": {
      if (!isAllowedWorkspacePath(action.dest.path)) return state;
      const recents = pushRecent(state.recents, action.dest);
      // The same destination is never open twice: bring the existing one forward instead.
      const inDock = state.dock.panes.find((p) => sameDest(p.dest, action.dest));
      if (inDock) return { ...state, recents, dock: { ...state.dock, open: true, activeId: inDock.id } };
      const floating = state.floating.find((p) => sameDest(p.dest, action.dest));
      if (floating) {
        return { ...state, recents, floating: [...state.floating.filter((p) => p.id !== floating.id), { ...floating, minimized: false }] };
      }
      if (action.where === "dock") {
        if (state.dock.panes.length >= MAX_DOCK_PANES) return state;
        return { ...state, recents, dock: { ...state.dock, open: true, panes: [...state.dock.panes, { id: action.id, dest: action.dest }], activeId: action.id } };
      }
      if (state.floating.length >= MAX_FLOATING) return state;
      const { x, y } = cascade(state.floating, action.bounds);
      const card: FloatingPane = { id: action.id, dest: action.dest, x, y, w: FLOAT_DEFAULT_WIDTH, h: FLOAT_DEFAULT_HEIGHT, minimized: false };
      return { ...state, recents, floating: [...state.floating, card] };
    }
    case "close": {
      const panes = state.dock.panes.filter((p) => p.id !== action.id);
      const activeId = state.dock.activeId === action.id ? panes[panes.length - 1]?.id ?? null : state.dock.activeId;
      return { ...state, dock: { ...state.dock, panes, activeId, open: panes.length === 0 ? false : state.dock.open }, floating: state.floating.filter((p) => p.id !== action.id) };
    }
    case "activate": {
      if (state.dock.panes.some((p) => p.id === action.id)) return { ...state, dock: { ...state.dock, activeId: action.id, open: true } };
      // On a narrow window a floating card is shown as a dock tab; picking that tab docks it for real.
      return state.floating.some((p) => p.id === action.id) ? reduce(state, { type: "toDock", id: action.id }) : state;
    }
    case "setDockOpen":
      return { ...state, dock: { ...state.dock, open: action.open && state.dock.panes.length > 0 } };
    case "setDockWidth":
      return { ...state, dock: { ...state.dock, width: clamp(Math.round(action.width), DOCK_MIN_WIDTH, DOCK_MAX_WIDTH) } };
    case "move":
      return {
        ...state,
        floating: state.floating.map((p) =>
          p.id === action.id
            ? { ...p, x: clamp(Math.round(action.x), 0, Math.max(0, action.bounds.width - 120)), y: clamp(Math.round(action.y), 0, Math.max(0, action.bounds.height - 40)) }
            : p
        ),
      };
    case "resize":
      return {
        ...state,
        floating: state.floating.map((p) =>
          p.id === action.id
            ? {
                ...p,
                w: clamp(Math.round(action.w), FLOAT_MIN_WIDTH, Math.max(FLOAT_MIN_WIDTH, action.bounds.width - p.x)),
                h: clamp(Math.round(action.h), FLOAT_MIN_HEIGHT, Math.max(FLOAT_MIN_HEIGHT, action.bounds.height - p.y)),
              }
            : p
        ),
      };
    case "minimize":
      return { ...state, floating: state.floating.map((p) => (p.id === action.id ? { ...p, minimized: action.minimized } : p)) };
    case "raise": {
      const card = state.floating.find((p) => p.id === action.id);
      if (!card || state.floating[state.floating.length - 1].id === card.id) return state;
      return { ...state, floating: [...state.floating.filter((p) => p.id !== action.id), card] };
    }
    case "toDock": {
      const card = state.floating.find((p) => p.id === action.id);
      if (!card || state.dock.panes.length >= MAX_DOCK_PANES) return state;
      return {
        ...state,
        floating: state.floating.filter((p) => p.id !== action.id),
        dock: { ...state.dock, open: true, panes: [...state.dock.panes, { id: card.id, dest: card.dest }], activeId: card.id },
      };
    }
    case "toFloating": {
      const pane = state.dock.panes.find((p) => p.id === action.id);
      if (!pane || state.floating.length >= MAX_FLOATING) return state;
      const panes = state.dock.panes.filter((p) => p.id !== action.id);
      const { x, y } = cascade(state.floating, action.bounds);
      return {
        ...state,
        dock: { ...state.dock, panes, activeId: state.dock.activeId === action.id ? panes[panes.length - 1]?.id ?? null : state.dock.activeId, open: panes.length === 0 ? false : state.dock.open },
        floating: [...state.floating, { id: pane.id, dest: pane.dest, x, y, w: FLOAT_DEFAULT_WIDTH, h: FLOAT_DEFAULT_HEIGHT, minimized: false }],
      };
    }
    case "reorderDock": {
      const from = state.dock.panes.findIndex((p) => p.id === action.id);
      if (from < 0) return state;
      const panes = [...state.dock.panes];
      const [item] = panes.splice(from, 1);
      panes.splice(clamp(action.toIndex, 0, panes.length), 0, item);
      return { ...state, dock: { ...state.dock, panes } };
    }
    case "clearRecents":
      return { ...state, recents: [] };
    case "replace":
      return sanitizeLayout(action.layout);
  }
}

// What is actually shown at this window width: below the floating threshold, floating cards are shown as extra dock tabs (the saved layout is not changed).
export function effectiveLayout(state: WorkspaceLayout, viewportWidth: number): WorkspaceLayout {
  if (viewportWidth >= MIN_VIEWPORT_FOR_FLOATING || state.floating.length === 0) return state;
  const extra = state.floating.map((p) => ({ id: p.id, dest: p.dest }));
  const panes = [...state.dock.panes, ...extra].slice(0, MAX_DOCK_PANES + MAX_FLOATING);
  return { ...state, dock: { ...state.dock, panes, activeId: state.dock.activeId ?? panes[0]?.id ?? null }, floating: [] };
}

// ---- snapping and tiling for floating cards ----
export type SnapSide = "left" | "right" | "full";

// A card snapped to half or all of the space beside the dock (`area` is that space).
export function snapRect(side: SnapSide, area: Bounds): { x: number; y: number; w: number; h: number } {
  if (side === "full") return { x: 0, y: 0, w: Math.max(FLOAT_MIN_WIDTH, area.width), h: Math.max(FLOAT_MIN_HEIGHT, area.height) };
  const half = Math.max(FLOAT_MIN_WIDTH, Math.floor(area.width / 2));
  return { x: side === "left" ? 0 : Math.max(0, area.width - half), y: 0, w: half, h: Math.max(FLOAT_MIN_HEIGHT, area.height) };
}

// Lay all the open (not minimized) cards side by side in rows of at most `perRow`, filling `area`.
export function tileFloating(state: WorkspaceLayout, area: Bounds, perRow = 2): WorkspaceLayout {
  const shown = state.floating.filter((p) => !p.minimized);
  if (shown.length === 0) return state;
  const cols = Math.min(perRow, shown.length);
  const rows = Math.ceil(shown.length / cols);
  const w = Math.max(FLOAT_MIN_WIDTH, Math.floor(area.width / cols));
  const h = Math.max(FLOAT_MIN_HEIGHT, Math.floor(area.height / rows));
  const place = new Map(shown.map((p, i) => [p.id, { x: (i % cols) * w, y: Math.floor(i / cols) * h, w, h }] as const));
  return { ...state, floating: state.floating.map((p) => (place.has(p.id) ? { ...p, ...place.get(p.id)! } : p)) };
}

// ---- saving, loading, repairing ----
function cleanDest(d: unknown): WorkspaceDestination | null {
  if (!d || typeof d !== "object") return null;
  const o = d as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.label !== "string" || typeof o.path !== "string") return null;
  if (!isAllowedWorkspacePath(o.path)) return null;
  return { id: o.id.slice(0, 120), label: o.label.slice(0, 120), path: o.path, section: typeof o.section === "string" ? o.section.slice(0, 80) : "", keywords: Array.isArray(o.keywords) ? o.keywords.filter((k): k is string => typeof k === "string").map((k) => k.slice(0, 40)).slice(0, 10) : undefined };
}

// Anything read back from storage is untrusted (an old version, a hand edit, a bug): keep what is valid, drop the rest, never throw.
export function sanitizeLayout(input: unknown): WorkspaceLayout {
  if (!input || typeof input !== "object") return EMPTY_LAYOUT;
  const raw = input as Record<string, any>;
  if (raw.version !== LAYOUT_VERSION) return EMPTY_LAYOUT;
  const seenIds = new Set<string>();
  const seenDest = new Set<string>();
  const takeId = (v: unknown): string | null => (typeof v === "string" && v.length > 0 && v.length <= 80 && !seenIds.has(v) ? (seenIds.add(v), v) : null);

  const dockPanes: PaneState[] = [];
  for (const p of Array.isArray(raw.dock?.panes) ? raw.dock.panes : []) {
    const dest = cleanDest(p?.dest);
    const id = dest && !seenDest.has(dest.id) ? takeId(p?.id) : null;
    if (!dest || !id || dockPanes.length >= MAX_DOCK_PANES) continue;
    seenDest.add(dest.id);
    dockPanes.push({ id, dest });
  }
  const floating: FloatingPane[] = [];
  for (const p of Array.isArray(raw.floating) ? raw.floating : []) {
    const dest = cleanDest(p?.dest);
    const id = dest && !seenDest.has(dest.id) ? takeId(p?.id) : null;
    if (!dest || !id || floating.length >= MAX_FLOATING) continue;
    seenDest.add(dest.id);
    floating.push({
      id,
      dest,
      x: clamp(Number(p.x), 0, 4000),
      y: clamp(Number(p.y), 0, 4000),
      w: clamp(Number(p.w), FLOAT_MIN_WIDTH, 2000),
      h: clamp(Number(p.h), FLOAT_MIN_HEIGHT, 2000),
      minimized: p.minimized === true,
    });
  }
  const recents: WorkspaceDestination[] = [];
  for (const r of Array.isArray(raw.recents) ? raw.recents : []) {
    const dest = cleanDest(r);
    if (dest && !recents.some((x) => x.id === dest.id) && recents.length < 8) recents.push(dest);
  }
  const activeId = typeof raw.dock?.activeId === "string" && dockPanes.some((p) => p.id === raw.dock.activeId) ? raw.dock.activeId : dockPanes[dockPanes.length - 1]?.id ?? null;
  return {
    version: LAYOUT_VERSION,
    dock: { open: raw.dock?.open === true && dockPanes.length > 0, width: clamp(Number(raw.dock?.width), DOCK_MIN_WIDTH, DOCK_MAX_WIDTH), panes: dockPanes, activeId },
    floating,
    recents,
  };
}

export const layoutStorageKey = (coachId: string) => `esc.workspace.v${LAYOUT_VERSION}:${coachId}`;

export function readLayout(coachId: string, storage: Pick<Storage, "getItem"> | null): WorkspaceLayout | null {
  try {
    const raw = storage?.getItem(layoutStorageKey(coachId));
    return raw ? sanitizeLayout(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function writeLayout(coachId: string, layout: WorkspaceLayout, storage: Pick<Storage, "setItem"> | null): void {
  try {
    storage?.setItem(layoutStorageKey(coachId), JSON.stringify(layout));
  } catch {
    // Storage full or blocked: the layout still works for this visit.
  }
}

// ---- moving over from the old panel and card stack ----
// The old shell had a left panel showing one of four mini views, or a stack of floating cards of the same four. Anyone who set that up finds the same things open.
export interface LegacyWorkspace {
  panelView: "roster" | "business" | "calendar" | "program" | null;
  panelWidth: number | null;
  panelCollapsed: boolean | null;
  layoutMode: "traditional" | "card_stack" | null;
  cards: { view: "roster" | "business" | "calendar" | "program"; x: number; y: number; width: number; height: number }[];
}

const LEGACY_DEST: Record<string, { page: string; label: string; section: string; path: (g: string) => string }> = {
  roster: { page: "clients", label: "Clients", section: "Run my day", path: () => "/clients" },
  business: { page: "business", label: "Business overview", section: "Business", path: (g) => `/groups/${g}/business` },
  calendar: { page: "calendar", label: "Calendar", section: "Run my day", path: (g) => `/groups/${g}/calendar` },
  program: { page: "programs", label: "Programs", section: "Programming", path: (g) => `/groups/${g}/programs` },
};

export function migrateLegacy(legacy: LegacyWorkspace, groupId: string, newId: () => string): WorkspaceLayout | null {
  const dest = (view: string): WorkspaceDestination | null => {
    const m = LEGACY_DEST[view];
    if (!m) return null;
    const d: WorkspaceDestination = { id: m.page === "clients" ? `page:${m.page}` : `page:${m.page}:${groupId}`, label: m.label, section: m.section, path: m.path(groupId) };
    return isAllowedWorkspacePath(d.path) ? d : null;
  };
  let layout: WorkspaceLayout = EMPTY_LAYOUT;
  if (legacy.layoutMode === "card_stack") {
    for (const c of legacy.cards) {
      const d = dest(c.view);
      if (!d) continue;
      layout = reduce(layout, { type: "open", id: newId(), dest: d, where: "floating" });
      const card = layout.floating[layout.floating.length - 1];
      if (card && card.dest.id === d.id) {
        layout = {
          ...layout,
          floating: layout.floating.map((p) => (p.id === card.id ? { ...p, x: clamp(c.x, 0, 4000), y: clamp(c.y, 0, 4000), w: clamp(c.width, FLOAT_MIN_WIDTH, 2000), h: clamp(c.height, FLOAT_MIN_HEIGHT, 2000) } : p)),
        };
      }
    }
  } else if (legacy.panelView) {
    const d = dest(legacy.panelView);
    if (d) layout = reduce(layout, { type: "open", id: newId(), dest: d, where: "dock" });
    layout = {
      ...layout,
      dock: { ...layout.dock, open: legacy.panelCollapsed === false || (legacy.panelCollapsed === null && layout.dock.panes.length > 0), width: clamp(legacy.panelWidth ?? DOCK_DEFAULT_WIDTH, DOCK_MIN_WIDTH, DOCK_MAX_WIDTH) },
    };
  }
  // Nothing was set up before: start empty (the coach adds what they want).
  const anything = layout.dock.panes.length > 0 || layout.floating.length > 0;
  return anything ? layout : null;
}

// On sign-out the saved workspace goes too (its labels carry client names, and the next person on a shared computer must not see them).
export function clearWorkspaceStorage(storage: Pick<Storage, "length" | "key" | "removeItem"> | null): void {
  try {
    if (!storage) return;
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith("esc.workspace.")) keys.push(k);
    }
    keys.forEach((k) => storage.removeItem(k));
  } catch {
    // Storage blocked: nothing was saved there.
  }
}
