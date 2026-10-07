"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  EMPTY_LAYOUT,
  effectiveLayout,
  migrateLegacy,
  readLayout,
  reduce,
  writeLayout,
  type Bounds,
  type WorkspaceAction,
  type WorkspaceLayout,
} from "@/lib/workspace-layout";
import type { WorkspaceDestination } from "@/lib/workspace-destinations";
import { readCardStackLayout, readLayoutMode } from "@/lib/coach-shell-panel-storage";
import { MUTATION_MESSAGE, debounce, installMutationReporter } from "@/lib/workspace-mutation";

// The unified workspace's state for one coach in one browser: what is open in the right-hand panel and as floating cards (lib/workspace-layout.ts holds the rules),
// kept in this browser, shared live between this coach's tabs, and a "something was saved" signal that makes every pane show the change.
// The rail's own left panel is NOT part of this: it stays the coach's navigator.

// Where the rail ends and the floating area begins (the rail is 64 px wide plus its border).
export const RAIL_WIDTH = 72;
// Top bar (56) plus the workspace toolbar (44).
export const TOP_OFFSET = 100;

interface WorkspaceApi {
  ready: boolean;
  enabled: boolean;
  // What is shown at this window width (floating cards become dock tabs on a narrow window).
  layout: WorkspaceLayout;
  viewportWidth: number;
  // The space cards float in: right of the rail, under the toolbar.
  area: Bounds;
  dispatch: (action: WorkspaceAction) => void;
  openDest: (dest: WorkspaceDestination, where: "dock" | "floating") => void;
  pickerOpen: boolean;
  setPickerOpen: (open: boolean) => void;
  groupId: string;
  isShared: boolean;
  registerFrame: (paneId: string, el: HTMLIFrameElement | null) => void;
  reloadPane: (paneId: string) => void;
  // Closes a pane without losing a half-finished edit: a field being edited is let go of first (the app saves a field when it loses focus), and the pane is removed a
  // moment later so that save is not cut off.
  requestClose: (paneId: string) => void;
}

const Ctx = createContext<WorkspaceApi | null>(null);

export function useWorkspace(): WorkspaceApi | null {
  return useContext(Ctx);
}

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);

export function WorkspaceProvider({ coachId, groupId, isShared, children }: { coachId: string | null; groupId: string; isShared: boolean; children: React.ReactNode }) {
  const router = useRouter();
  const [stored, dispatch] = useReducer(reduce, EMPTY_LAYOUT);
  const [ready, setReady] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [viewport, setViewport] = useState({ width: 1440, height: 900 });
  const frames = useRef(new Map<string, HTMLIFrameElement>());
  const fromOtherTab = useRef(false);
  const tabId = useRef(newId());
  const enabled = !!coachId;

  // Load once the coach is known: this browser's saved layout, else whatever the old floating card stack had open.
  useEffect(() => {
    if (!coachId) return;
    const saved = readLayout(coachId, window.localStorage);
    if (saved) {
      dispatch({ type: "replace", layout: saved });
    } else {
      const legacy = migrateLegacy({ panelView: null, panelWidth: null, panelCollapsed: null, layoutMode: readLayoutMode(), cards: readCardStackLayout() }, groupId, newId);
      if (legacy) {
        dispatch({ type: "replace", layout: legacy });
        writeLayout(coachId, legacy, window.localStorage);
      }
    }
    setReady(true);
    // groupId only matters for the one-time move-over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coachId]);

  useEffect(() => {
    function measure() {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Save, and tell the coach's other tabs.
  const channelRef = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    if (!coachId || typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(`esc-workspace:${coachId}`);
    channelRef.current = channel;
    channel.onmessage = (e: MessageEvent) => {
      if (e.data?.from === tabId.current || !e.data?.layout) return;
      fromOtherTab.current = true;
      dispatch({ type: "replace", layout: e.data.layout });
    };
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [coachId]);
  useEffect(() => {
    if (!ready || !coachId) return;
    writeLayout(coachId, stored, window.localStorage);
    if (fromOtherTab.current) {
      fromOtherTab.current = false;
      return;
    }
    channelRef.current?.postMessage({ from: tabId.current, layout: stored });
  }, [stored, ready, coachId]);

  // Cross-pane refresh: a save on this page reloads every pane; a save inside a pane reloads the OTHER panes and refreshes this page.
  const registerFrame = useCallback((paneId: string, el: HTMLIFrameElement | null) => {
    if (el) frames.current.set(paneId, el);
    else frames.current.delete(paneId);
  }, []);
  const reloadPane = useCallback((paneId: string) => {
    const el = frames.current.get(paneId);
    if (!el) return;
    try {
      el.contentWindow?.location.reload();
    } catch {
      el.src = el.src;
    }
  }, []);
  const requestClose = useCallback((paneId: string) => {
    const el = frames.current.get(paneId);
    let waited = false;
    try {
      const active = el?.contentDocument?.activeElement as HTMLElement | null | undefined;
      const editable = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT" || active.isContentEditable);
      if (editable) {
        active.blur();
        waited = true;
      }
    } catch {
      // The page is not readable (still loading): just close it.
    }
    if (waited) setTimeout(() => dispatch({ type: "close", id: paneId }), 700);
    else dispatch({ type: "close", id: paneId });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const reloadAll = (except: Window | null) => {
      frames.current.forEach((el) => {
        if (except && el.contentWindow === except) return;
        try {
          el.contentWindow?.location.reload();
        } catch {
          el.src = el.src;
        }
      });
    };
    let lastSource: Window | null = null;
    const fromPane = debounce(() => {
      reloadAll(lastSource);
      router.refresh();
    }, 1500);
    const fromPage = debounce(() => reloadAll(null), 1500);
    const undo = installMutationReporter(fromPage);
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin || e.data?.type !== MUTATION_MESSAGE) return;
      const known = Array.from(frames.current.values()).some((f) => f.contentWindow === e.source);
      if (!known) return;
      lastSource = e.source as Window;
      fromPane();
    }
    window.addEventListener("message", onMessage);
    return () => {
      undo();
      window.removeEventListener("message", onMessage);
    };
  }, [enabled, router]);

  const layout = useMemo(() => effectiveLayout(stored, viewport.width), [stored, viewport.width]);
  const area = useMemo<Bounds>(() => {
    const dockWidth = layout.dock.open && layout.dock.panes.length > 0 ? Math.min(layout.dock.width, Math.max(0, viewport.width - RAIL_WIDTH - 360)) : 0;
    return { width: Math.max(320, viewport.width - RAIL_WIDTH - dockWidth), height: Math.max(240, viewport.height - TOP_OFFSET) };
  }, [layout.dock.open, layout.dock.panes.length, layout.dock.width, viewport]);

  const openDest = useCallback(
    (dest: WorkspaceDestination, where: "dock" | "floating") => {
      dispatch({ type: "open", id: newId(), dest, where, bounds: area });
    },
    [area]
  );

  const api = useMemo<WorkspaceApi>(
    () => ({ ready, enabled, layout, viewportWidth: viewport.width, area, dispatch, openDest, pickerOpen, setPickerOpen, groupId, isShared, registerFrame, reloadPane, requestClose }),
    [ready, enabled, layout, viewport.width, area, openDest, pickerOpen, groupId, isShared, registerFrame, reloadPane, requestClose]
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
