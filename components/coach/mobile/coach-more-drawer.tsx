"use client";

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  Menu,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  Users,
  TrendingUp,
  CalendarDays,
  Dumbbell,
  MessageCircle,
  CreditCard,
} from "lucide-react";
import {
  readAskSpotWidgetState,
  writeAskSpotWidgetState,
  DEFAULT_ASK_SPOT_WIDGET_STATE,
} from "@/lib/ask-spot-widget-state";
import { RosterMiniList } from "@/components/coach/desktop/roster-mini-list";
import { BusinessMiniDashboard } from "@/components/coach/desktop/business-mini-dashboard";
import { CalendarMiniView } from "@/components/coach/desktop/calendar-mini-view";
import { ProgramMiniView } from "@/components/coach/desktop/program-mini-view";
import { AskSpotChatPanel } from "@/components/coach/ask-spot-chat-panel";
import { QuickPaymentPanel } from "./quick-payment-panel";
import { CoachNavLinksList } from "./coach-nav-links-list";

const STORAGE_KEY = "coach-more-drawer-state";
const MIN_BOTTOM = 88; // clears the bottom tab bar (64px) + margin
const TOP_SAFE_MARGIN = 160; // keeps the tab and its open panel clear of a top-anchored control (e.g. The Spot)
const DRAG_THRESHOLD = 6; // px of pointer movement before a press counts as a drag, not a tap
const SWIPE_DISTANCE_THRESHOLD = 36; // px, horizontal — an edge-panel swipe is a short flick, not a long drag

function clampBottom(value: number): number {
  const ceiling = typeof window !== "undefined" ? window.innerHeight - TOP_SAFE_MARGIN : 600;
  return Math.min(Math.max(value, MIN_BOTTOM), Math.max(MIN_BOTTOM, ceiling));
}

type TileKey = "clients" | "business" | "calendar" | "program" | "ask-spot" | "quick-payment";

const TILES: { key: TileKey; label: string; icon: typeof Users }[] = [
  { key: "clients", label: "Clients", icon: Users },
  { key: "business", label: "Business", icon: TrendingUp },
  { key: "calendar", label: "Calendar", icon: CalendarDays },
  { key: "program", label: "Program", icon: Dumbbell },
  { key: "ask-spot", label: "Ask Spot", icon: MessageCircle },
  { key: "quick-payment", label: "Quick Payment", icon: CreditCard },
];

// Replaces the mobile coach "More" bottom-nav tab's old full-page sheet
// (mobile_more_tab_condensed_widget_hub_sept30.md) — a Samsung Edge-
// Panel-style drawer, same visual/gesture mechanics already proven by
// the desktop Ask Spot tab (collective-intelligence-chat.tsx), which
// this absorbs as one tile rather than shipping as its own separate
// dock. Condenses the desktop floating card-stack's 4 real widgets
// (Clients/Business/Calendar/Program — same components, same real data,
// just rendered full-width inline here instead of as draggable/
// resizable floating windows) alongside Ask Spot and a new Quick
// Payment action, plus every genuine full-page nav destination
// (CoachNavLinksList) as plain tap-to-navigate rows below the tiles —
// two honest kinds of rows in one drawer, not everything forced into
// the same inline-expand pattern.
//
// Three real states: "tab" (collapsed, always reachable, never fully
// vanishes), "tiles" (the row of 6 + nav links), or one specific tile
// expanded to fill the drawer. The bottom-nav "More" tap (openSignal,
// incremented by the parent on each tap) opens straight to "tiles";
// swiping/tapping the panel's own header always collapses all the way
// back to "tab"; the back arrow shown next to an expanded tile's title
// only steps back one level, to "tiles".
export function CoachMoreDrawer({
  groupId,
  groupName,
  openSignal,
}: {
  groupId: string;
  groupName: string;
  openSignal: number;
}) {
  const [view, setView] = useState<"tab" | "tiles" | TileKey>("tab");
  const [side, setSide] = useState<"left" | "right">(DEFAULT_ASK_SPOT_WIDGET_STATE.side);
  const [bottomOffset, setBottomOffset] = useState(DEFAULT_ASK_SPOT_WIDGET_STATE.bottomOffsetPx);
  const tabDrag = useRef<{ x: number; y: number; startBottom: number; moved: boolean } | null>(null);
  const headerDrag = useRef<{ x: number; moved: boolean } | null>(null);
  const lastOpenSignal = useRef(openSignal);

  // Hydrated from localStorage on mount only — avoids a server/client
  // markup mismatch (the default above is what both render identically
  // before this runs).
  useEffect(() => {
    const saved = readAskSpotWidgetState(STORAGE_KEY);
    setSide(saved.side);
    setBottomOffset(clampBottom(saved.bottomOffsetPx));
  }, []);

  // External trigger from the bottom-nav "More" tap. Skips the very
  // first render so mounting with whatever counter value the parent
  // started at doesn't pop the drawer open unasked.
  useEffect(() => {
    if (openSignal === lastOpenSignal.current) return;
    lastOpenSignal.current = openSignal;
    setView("tiles");
  }, [openSignal]);

  function persist(nextSide: "left" | "right", nextBottom: number) {
    writeAskSpotWidgetState(STORAGE_KEY, { side: nextSide, bottomOffsetPx: nextBottom });
  }

  // --- Tab (collapsed) gestures: vertical drag repositions along the
  // edge; a plain tap, or a short outward swipe, opens the tile row.
  function handleTabPointerDown(e: ReactPointerEvent<HTMLButtonElement>) {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Unsupported/invalid pointer id — drag still tracks via the
      // bubbled move/up handlers below, same fallback already used by
      // exercise-swipe-carousel.tsx's own scrubber.
    }
    tabDrag.current = { x: e.clientX, y: e.clientY, startBottom: bottomOffset, moved: false };
  }

  function handleTabPointerMove(e: ReactPointerEvent<HTMLButtonElement>) {
    const drag = tabDrag.current;
    if (!drag || e.buttons === 0) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
      drag.moved = true;
    }
    if (drag.moved && Math.abs(dy) >= Math.abs(dx)) {
      setBottomOffset(clampBottom(drag.startBottom - dy));
    }
  }

  function handleTabPointerUp(e: ReactPointerEvent<HTMLButtonElement>) {
    const drag = tabDrag.current;
    tabDrag.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // No-op if it was never captured.
    }
    if (!drag) return;

    if (!drag.moved) {
      setView("tiles");
      return;
    }

    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    const swipedOutward = side === "right" ? dx < -SWIPE_DISTANCE_THRESHOLD : dx > SWIPE_DISTANCE_THRESHOLD;
    if (swipedOutward && Math.abs(dx) > Math.abs(dy)) {
      setView("tiles");
    }

    const finalBottom = clampBottom(drag.startBottom - dy);
    persist(side, finalBottom);
  }

  // --- Panel header gestures: a tap or an inward swipe always collapses
  // all the way back to the tab, regardless of which sub-view is
  // showing — the back arrow (only present when a tile is expanded)
  // handles stepping back one level instead.
  function handleHeaderPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // See handleTabPointerDown.
    }
    headerDrag.current = { x: e.clientX, moved: false };
  }

  function handleHeaderPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = headerDrag.current;
    if (!drag || e.buttons === 0) return;
    if (Math.abs(e.clientX - drag.x) > DRAG_THRESHOLD) drag.moved = true;
  }

  function handleHeaderPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = headerDrag.current;
    headerDrag.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // No-op if it was never captured.
    }
    if (!drag) return;
    if (!drag.moved) {
      setView("tab");
      return;
    }
    const dx = e.clientX - drag.x;
    const swipedInward = side === "right" ? dx > SWIPE_DISTANCE_THRESHOLD : dx < -SWIPE_DISTANCE_THRESHOLD;
    if (swipedInward) setView("tab");
  }

  const edgeStyle: React.CSSProperties = { bottom: bottomOffset, [side]: 0 } as React.CSSProperties;
  const ChevronIcon = side === "right" ? ChevronLeft : ChevronRight;

  if (view === "tab") {
    return (
      <button
        type="button"
        aria-label="Open More"
        style={edgeStyle}
        className={`fixed z-40 w-7 h-14 bg-rust/80 active:bg-rust transition-colors flex items-center justify-center touch-none select-none ${
          side === "right" ? "rounded-l-token-sm" : "rounded-r-token-sm"
        }`}
        onPointerDown={handleTabPointerDown}
        onPointerMove={handleTabPointerMove}
        onPointerUp={handleTabPointerUp}
      >
        <Menu className="w-3.5 h-3.5 text-graphite" />
      </button>
    );
  }

  const activeTile = TILES.find((t) => t.key === view) ?? null;

  return (
    <div
      style={edgeStyle}
      className="fixed z-40 w-[92vw] max-w-sm h-[78vh] max-h-[640px] bg-graphite border border-steel/30 shadow-2xl flex flex-col"
    >
      <div
        onPointerDown={handleHeaderPointerDown}
        onPointerMove={handleHeaderPointerMove}
        onPointerUp={handleHeaderPointerUp}
        className="px-4 py-3 border-b border-steel/20 flex items-center justify-between gap-2 touch-none select-none cursor-grab shrink-0"
      >
        <div className="flex items-center gap-2 min-w-0">
          {activeTile && (
            <button
              type="button"
              onClick={() => setView("tiles")}
              aria-label="Back to tiles"
              className="w-6 h-6 flex items-center justify-center text-steel active:text-rust shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <p className="font-body text-[10px] text-steel uppercase tracking-wide font-bold truncate">
            {activeTile ? activeTile.label : "More"}
          </p>
        </div>
        <ChevronIcon className="w-4 h-4 text-steel shrink-0" aria-label="Collapse" />
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {view === "tiles" && (
          <div className="h-full overflow-y-auto">
            <div className="grid grid-cols-2 gap-2 p-4">
              {TILES.map((tile) => {
                const Icon = tile.icon;
                return (
                  <button
                    key={tile.key}
                    type="button"
                    onClick={() => setView(tile.key)}
                    className="border border-steel/20 p-3 flex flex-col items-center gap-1.5 active:border-rust active:bg-rust/5 transition-colors"
                  >
                    <Icon className="w-5 h-5 text-rust" strokeWidth={2.25} />
                    <span className="font-body text-xs text-chalk text-center">{tile.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="border-t border-steel/20">
              <CoachNavLinksList groupId={groupId} groupName={groupName} />
            </div>
          </div>
        )}
        {view === "clients" && (
          <div className="h-full overflow-y-auto p-4">
            <RosterMiniList groupId={groupId} />
          </div>
        )}
        {view === "business" && (
          <div className="h-full overflow-y-auto p-4">
            <BusinessMiniDashboard groupId={groupId} expanded />
          </div>
        )}
        {view === "calendar" && (
          <div className="h-full overflow-y-auto p-4">
            <CalendarMiniView groupId={groupId} />
          </div>
        )}
        {view === "program" && (
          <div className="h-full overflow-y-auto p-4">
            <ProgramMiniView groupId={groupId} />
          </div>
        )}
        {view === "ask-spot" && (
          <div className="h-full flex flex-col">
            <AskSpotChatPanel />
          </div>
        )}
        {view === "quick-payment" && <QuickPaymentPanel groupId={groupId} />}
      </div>
    </div>
  );
}
