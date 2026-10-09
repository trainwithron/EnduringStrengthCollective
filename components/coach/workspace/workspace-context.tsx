"use client";

import { confirmDialog } from "@/components/shared/confirm-dialog";
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  EMPTY_LAYOUT,
  LAYOUT_VERSION,
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
import { clearWorkspaceStorage } from "@/lib/workspace-layout";
import { MUTATION_MESSAGE, REFRESH_MESSAGE, SIGNED_OUT_MESSAGE, createRefreshLimiter, debounce, installMutationReporter, paneActivity } from "@/lib/workspace-mutation";

// The unified workspace's state for one coach in one browser: what is open in the right-hand panel and as floating cards (lib/workspace-layout.ts holds the rules),
// kept in this browser, shared live between this coach's tabs, and a "something was saved" signal that refreshes the panes softly. It lives in the coach area's layout
// (components/coach/workspace/workspace-host.tsx), ABOVE the pages, so panes keep their pages (and anything half-typed in them) while the main page navigates.
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
  // The panel's width in pixels right now (0 when it is closed or there is no room).
  dockWidth: number;
  dispatch: (action: WorkspaceAction) => void;
  openDest: (dest: WorkspaceDestination, where: "dock" | "floating") => void;
  pickerOpen: boolean;
  setPickerOpen: (open: boolean) => void;
  groupId: string;
  groupName: string;
  isShared: boolean;
  registerFrame: (paneId: string, el: HTMLIFrameElement | null) => void;
  // Closes a pane without losing work: waits for saves that are still going, and asks first if there is typed text that was never saved.
  requestClose: (paneId: string) => void;
  // Automatic refreshes are limited (3 a minute); when the limit is hit they pause and this is true, until the coach refreshes by hand.
  refreshPaused: boolean;
  refreshNow: () => void;
  // A pane found the session has ended.
  signedOut: boolean;
  // No coach page is on screen right now (an athlete page, say): the workspace is kept, but hidden, never torn down.
  suspended: boolean;
}

const Ctx = createContext<WorkspaceApi | null>(null);

export function useWorkspace(): WorkspaceApi | null {
  return useContext(Ctx);
}

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);

type PaneWindow = Window & { __escPane?: typeof paneActivity };

export function WorkspaceProvider({
  coachId,
  groupId,
  groupName,
  isShared,
  suspended,
  children,
}: {
  coachId: string | null;
  groupId: string;
  groupName: string;
  isShared: boolean;
  suspended: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [stored, dispatch] = useReducer(reduce, EMPTY_LAYOUT);
  const [ready, setReady] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [viewport, setViewport] = useState({ width: 1440, height: 900 });
  const [refreshPaused, setRefreshPaused] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  // After the session ends nothing more is saved (and what was saved is cleared): a signed-out browser keeps no client names.
  const sessionEnded = useRef(false);
  const frames = useRef(new Map<string, HTMLIFrameElement>());
  const tabId = useRef(newId());
  // The layout a message from another tab carried: when our state becomes exactly that, it is not sent back out.
  const echoOf = useRef<string | null>(null);
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
    // Make sure the page's fetch is wrapped before anything saves (see lib/workspace-mutation.ts).
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
      const incoming = e.data?.layout;
      if (e.data?.from === tabId.current || !incoming) return;
      // A tab running a different version of the app (during a deploy) must not overwrite this one's layout with what it understands.
      if (incoming.version !== LAYOUT_VERSION) return;
      echoOf.current = JSON.stringify(incoming);
      setTimeout(() => {
        echoOf.current = null;
      }, 2000);
      dispatch({ type: "replace", layout: incoming });
    };
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [coachId]);
  // Saved a moment after the last change (dragging a card changes the layout on every move: one save when it settles, not hundreds).
  useEffect(() => {
    if (!ready || !coachId) return;
    const timer = setTimeout(() => {
      if (sessionEnded.current) return;
      writeLayout(coachId, stored, window.localStorage);
      if (echoOf.current !== null && JSON.stringify(stored) === echoOf.current) {
        echoOf.current = null;
        return;
      }
      channelRef.current?.postMessage({ from: tabId.current, layout: stored });
    }, 250);
    return () => clearTimeout(timer);
  }, [stored, ready, coachId]);

  const layout = useMemo(() => effectiveLayout(stored, viewport.width), [stored, viewport.width]);

  // The panel's width, and the room it takes from the page (the page keeps this much clear on its right: see the shell's main).
  const dockWidth = useMemo(() => {
    if (!enabled || !ready || suspended || viewport.width < 1024) return 0;
    if (!layout.dock.open || layout.dock.panes.length === 0) return 0;
    return Math.min(layout.dock.width, Math.max(300, viewport.width - RAIL_WIDTH - 360));
  }, [enabled, ready, suspended, layout.dock.open, layout.dock.panes.length, layout.dock.width, viewport.width]);
  useEffect(() => {
    document.documentElement.style.setProperty("--ws-dock", `${dockWidth}px`);
    return () => {
      document.documentElement.style.removeProperty("--ws-dock");
    };
  }, [dockWidth]);

  const area = useMemo<Bounds>(
    () => ({ width: Math.max(320, viewport.width - RAIL_WIDTH - dockWidth), height: Math.max(240, viewport.height - TOP_OFFSET) }),
    [dockWidth, viewport]
  );

  const registerFrame = useCallback((paneId: string, el: HTMLIFrameElement | null) => {
    if (el) frames.current.set(paneId, el);
    else frames.current.delete(paneId);
  }, []);

  // Which panes the coach can see right now. A pane that is hidden (another tab, a closed panel, a minimized card) is not refreshed; it is refreshed when it is shown.
  const visibleIds = useMemo(() => {
    const ids = new Set<string>();
    if (suspended) return ids;
    if (layout.dock.open) {
      const active = layout.dock.panes.find((p) => p.id === layout.dock.activeId) ?? layout.dock.panes[0];
      if (active) ids.add(active.id);
    }
    for (const c of layout.floating) if (!c.minimized) ids.add(c.id);
    return ids;
  }, [layout, suspended]);
  const visibleRef = useRef(visibleIds);
  visibleRef.current = visibleIds;
  const stale = useRef(new Set<string>());

  // A SOFT refresh: the pane's page is asked to refresh its data (router.refresh inside the pane), which keeps what is typed in it. A hard reload is never used.
  const softRefresh = useCallback((paneId: string) => {
    const el = frames.current.get(paneId);
    try {
      el?.contentWindow?.postMessage({ type: REFRESH_MESSAGE }, window.location.origin);
    } catch {
      // not ready yet: it will load fresh anyway
    }
  }, []);
  useEffect(() => {
    stale.current.forEach((id) => {
      if (visibleIds.has(id)) {
        stale.current.delete(id);
        softRefresh(id);
      }
    });
  }, [visibleIds, softRefresh]);

  const refreshPanes = useCallback(
    (except: Window | null) => {
      frames.current.forEach((el, id) => {
        if (except && el.contentWindow === except) return;
        if (visibleRef.current.has(id)) softRefresh(id);
        else stale.current.add(id);
      });
    },
    [softRefresh]
  );

  // Automatic refreshes: at most three a minute, then they pause (and the toolbar says so) until the coach refreshes by hand. A page that saves on a timer could
  // otherwise keep every pane refreshing forever.
  const limiter = useRef(createRefreshLimiter(3, 60_000));
  const quietUntil = useRef(0);
  const attempt = useCallback(
    (except: Window | null, alsoPage: boolean) => {
      if (!limiter.current.allow()) {
        setRefreshPaused(true);
        console.warn("workspace: automatic refresh paused (more than 3 in a minute)");
        return;
      }
      // A refresh makes pages load, and a page may save something while loading (a "last seen" mark): saves in the next few seconds are ignored, so a refresh can
      // never set off another one.
      quietUntil.current = Date.now() + 6000;
      refreshPanes(except);
      if (alsoPage) router.refresh();
    },
    [refreshPanes, router]
  );
  const refreshNow = useCallback(() => {
    limiter.current.reset();
    setRefreshPaused(false);
    quietUntil.current = Date.now() + 6000;
    refreshPanes(null);
    router.refresh();
  }, [refreshPanes, router]);

  useEffect(() => {
    if (!enabled) return;
    let lastSource: Window | null = null;
    const fromPane = debounce(() => attempt(lastSource, true), 1500);
    const fromPage = debounce(() => attempt(null, false), 1500);
    const undo = installMutationReporter(() => {
      if (Date.now() >= quietUntil.current) fromPage();
    });
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      const known = Array.from(frames.current.values()).some((f) => f.contentWindow === e.source);
      if (!known) return;
      if (e.data?.type === SIGNED_OUT_MESSAGE) {
        setSignedOut(true);
        sessionEnded.current = true;
        clearWorkspaceStorage(window.localStorage);
        return;
      }
      if (e.data?.type !== MUTATION_MESSAGE || Date.now() < quietUntil.current) return;
      lastSource = e.source as Window;
      fromPane();
    }
    window.addEventListener("message", onMessage);
    return () => {
      undo();
      window.removeEventListener("message", onMessage);
    };
  }, [enabled, attempt]);

  const requestClose = useCallback((paneId: string) => {
    void (async () => {
      const el = frames.current.get(paneId);
      const activityOf = () => {
        try {
          return (el?.contentWindow as PaneWindow | null | undefined)?.__escPane;
        } catch {
          return undefined;
        }
      };
      try {
        const active = el?.contentDocument?.activeElement as HTMLElement | null | undefined;
        const editable = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT" || active.isContentEditable);
        if (editable) active.blur(); // the app saves a field when it loses focus
      } catch {
        // the page is not readable (still loading): just close it
      }
      // Give a save that this started a moment to begin, then wait (up to 5 s) for saves still going: removing the pane would cancel them.
      await new Promise((r) => setTimeout(r, 350));
      for (let i = 0; i < 50 && (activityOf()?.inFlight ?? 0) > 0; i++) await new Promise((r) => setTimeout(r, 100));
      if (activityOf()?.typed && !await confirmDialog("Close and discard what you typed? It has not been saved or sent.")) return;
      dispatch({ type: "close", id: paneId });
    })();
  }, []);

  const openDest = useCallback(
    (dest: WorkspaceDestination, where: "dock" | "floating") => {
      dispatch({ type: "open", id: newId(), dest, where, bounds: area });
    },
    [area]
  );

  const api = useMemo<WorkspaceApi>(
    () => ({ ready, enabled, layout, viewportWidth: viewport.width, area, dockWidth, dispatch, openDest, pickerOpen, setPickerOpen, groupId, groupName, isShared, registerFrame, requestClose, refreshPaused, refreshNow, signedOut, suspended }),
    [ready, enabled, layout, viewport.width, area, dockWidth, openDest, pickerOpen, groupId, groupName, isShared, registerFrame, requestClose, refreshPaused, refreshNow, signedOut, suspended]
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
