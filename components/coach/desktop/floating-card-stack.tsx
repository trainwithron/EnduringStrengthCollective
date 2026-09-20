"use client";

import { useEffect, useRef, useState } from "react";
import { X, Plus, Minimize2 } from "lucide-react";
import {
  readCardStackLayout,
  writeCardStackLayout,
  CARD_STACK_DEFAULT_WIDTH,
  CARD_STACK_DEFAULT_HEIGHT,
  CARD_STACK_MIN_WIDTH,
  CARD_STACK_MIN_HEIGHT,
  type ListPanelView,
  type CardStackEntry,
} from "@/lib/coach-shell-panel-storage";
import { RosterMiniList } from "./roster-mini-list";
import { BusinessMiniDashboard } from "./business-mini-dashboard";
import { CalendarMiniView } from "./calendar-mini-view";
import { ProgramMiniView } from "./program-mini-view";

// cascading_card_stack_widget_layering_idea.md — the "optional floating
// card stack" alternative to ShellListPanel's traditional one-at-a-time
// tab switcher. Same four mini-views, same real estate, but 2-4 shown
// simultaneously — a coach can freely drag and resize each one, "like a
// custom window" (Ron's own words after using the fixed-cascade version
// live), rather than a preset stacking pattern.
//
// Deliberately no shared dim backdrop: unlike QuickViewBubble's modal
// pattern, this replaces an always-visible, non-blocking panel
// (ShellListPanel itself has no backdrop either) — a coach should still
// be able to freely interact with the main content while these float
// alongside it.
const CARD_META: Record<ListPanelView, { label: string; icon: string }> = {
  roster: { label: "Clients", icon: "👥" },
  business: { label: "Business", icon: "💰" },
  calendar: { label: "Calendar", icon: "📅" },
  program: { label: "Program", icon: "🏋" },
};
const ALL_VIEWS: ListPanelView[] = ["roster", "business", "calendar", "program"];
const MAX_WIDTH = 900;
const MAX_HEIGHT = 900;
// A card's mini-view can render meaningfully richer content once it has
// real room for it — see BusinessMiniDashboard's own `expanded` prop.
// Deliberately well above CARD_STACK_DEFAULT_HEIGHT (560): this should
// only trigger once a coach actually drags the card noticeably taller
// than its default, not be on from the moment a card opens.
const EXPAND_HEIGHT_THRESHOLD = 640;

type DragState =
  | { kind: "move"; view: ListPanelView; startClientX: number; startClientY: number; origX: number; origY: number }
  | {
      kind: "resize";
      view: ListPanelView;
      startClientX: number;
      startClientY: number;
      origWidth: number;
      origHeight: number;
    };

export function FloatingCardStack({
  groupId,
  onExitToTraditional,
}: {
  groupId: string;
  onExitToTraditional: () => void;
}) {
  const [layout, setLayout] = useState<CardStackEntry[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const dragRef = useRef<DragState | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLayout(readCardStackLayout());
    setHydrated(true);
  }, []);

  function persist(next: CardStackEntry[]) {
    setLayout(next);
    writeCardStackLayout(next);
  }

  function bringToFront(view: ListPanelView) {
    setLayout((prev) => {
      const entry = prev.find((e) => e.view === view);
      if (!entry) return prev;
      const next = [entry, ...prev.filter((e) => e.view !== view)];
      writeCardStackLayout(next);
      return next;
    });
  }

  function closeCard(view: ListPanelView) {
    persist(layout.filter((e) => e.view !== view));
  }

  function openCard(view: ListPanelView) {
    if (layout.some((e) => e.view === view)) {
      bringToFront(view);
      return;
    }
    persist([
      { view, x: 16, y: 16, width: CARD_STACK_DEFAULT_WIDTH, height: CARD_STACK_DEFAULT_HEIGHT },
      ...layout,
    ]);
  }

  useEffect(() => {
    function onPointerMove(e: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const containerRect = containerRef.current?.getBoundingClientRect();
      const maxX = containerRect ? window.innerWidth - containerRect.left - 100 : 2000;
      const maxY = containerRect ? window.innerHeight - containerRect.top - 60 : 2000;

      setLayout((prev) =>
        prev.map((entry) => {
          if (entry.view !== drag.view) return entry;
          if (drag.kind === "move") {
            const dx = e.clientX - drag.startClientX;
            const dy = e.clientY - drag.startClientY;
            return {
              ...entry,
              x: Math.min(Math.max(0, drag.origX + dx), Math.max(0, maxX)),
              y: Math.min(Math.max(0, drag.origY + dy), Math.max(0, maxY)),
            };
          }
          const dw = e.clientX - drag.startClientX;
          const dh = e.clientY - drag.startClientY;
          return {
            ...entry,
            width: Math.min(MAX_WIDTH, Math.max(CARD_STACK_MIN_WIDTH, drag.origWidth + dw)),
            height: Math.min(MAX_HEIGHT, Math.max(CARD_STACK_MIN_HEIGHT, drag.origHeight + dh)),
          };
        })
      );
    }

    function onPointerUp() {
      if (!dragRef.current) return;
      dragRef.current = null;
      // Persist whatever pointermove last landed on — read fresh state
      // via the functional form so this doesn't close over a stale array.
      setLayout((prev) => {
        writeCardStackLayout(prev);
        return prev;
      });
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  function startMove(e: React.PointerEvent, entry: CardStackEntry) {
    // A drag always raises the card too, same as any real window manager.
    bringToFront(entry.view);
    dragRef.current = {
      kind: "move",
      view: entry.view,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: entry.x,
      origY: entry.y,
    };
  }

  function startResize(e: React.PointerEvent, entry: CardStackEntry) {
    e.stopPropagation();
    bringToFront(entry.view);
    dragRef.current = {
      kind: "resize",
      view: entry.view,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origWidth: entry.width,
      origHeight: entry.height,
    };
  }

  // Avoids a hydration flash of the default (all-4-open) order before
  // this coach's own saved preference loads from localStorage.
  if (!hydrated) return null;

  const closedViews = ALL_VIEWS.filter((v) => !layout.some((e) => e.view === v));

  return (
    <div ref={containerRef} className="hidden lg:block fixed left-4 top-[72px] z-40">
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        <button
          type="button"
          onClick={onExitToTraditional}
          className="h-7 px-2 flex items-center gap-1 font-body text-[11px] text-steel border border-steel/30 bg-surface rounded-token-lg active:text-chalk"
        >
          <Minimize2 className="w-3 h-3" />
          Collapse all
        </button>
        {closedViews.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => openCard(v)}
            className="h-7 px-2 flex items-center gap-1 font-body text-[11px] text-steel border border-steel/30 bg-surface rounded-token-lg active:text-chalk"
          >
            <Plus className="w-3 h-3" />
            {CARD_META[v].icon} {CARD_META[v].label}
          </button>
        ))}
      </div>

      {layout.length === 0 ? (
        <p className="font-body text-xs text-steel">All cards closed — reopen one above.</p>
      ) : (
        <div className="relative" style={{ width: 1, height: 1 }}>
          {layout.map((entry, index) => {
            const isFront = index === 0;
            const isExpanded = entry.height >= EXPAND_HEIGHT_THRESHOLD;
            return (
              <div
                key={entry.view}
                onPointerDown={() => !isFront && bringToFront(entry.view)}
                className="absolute bg-surface border border-steel/30 rounded-token-lg shadow-[0_12px_32px_-8px_rgba(0,0,0,0.6)] overflow-hidden flex flex-col"
                style={{
                  width: entry.width,
                  height: entry.height,
                  left: entry.x,
                  top: entry.y,
                  // Front of the z-order (index 0) must render visually
                  // on top — the exact inverse of `index` here is the
                  // real fix for the earlier bug where the nominal
                  // "front" card was actually buried behind the rest.
                  zIndex: 10 + (layout.length - index),
                }}
              >
                <div
                  onPointerDown={(e) => startMove(e, entry)}
                  className="flex items-center justify-between px-3 h-9 border-b border-steel/20 bg-surface/60 shrink-0 cursor-move select-none"
                >
                  <p className="font-body text-xs uppercase tracking-wide text-steel pointer-events-none">
                    {CARD_META[entry.view].icon} {CARD_META[entry.view].label}
                  </p>
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeCard(entry.view);
                    }}
                    aria-label={`Close ${CARD_META[entry.view].label}`}
                    className="w-6 h-6 flex items-center justify-center text-steel active:text-rust"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="p-3 overflow-y-auto flex-1">
                  {entry.view === "roster" && <RosterMiniList groupId={groupId} />}
                  {entry.view === "business" && <BusinessMiniDashboard groupId={groupId} expanded={isExpanded} />}
                  {entry.view === "calendar" && <CalendarMiniView groupId={groupId} />}
                  {entry.view === "program" && <ProgramMiniView groupId={groupId} />}
                </div>
                <div
                  onPointerDown={(e) => startResize(e, entry)}
                  aria-hidden
                  className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
                  style={{
                    background:
                      "linear-gradient(135deg, transparent 0%, transparent 45%, rgba(255,255,255,0.25) 50%, transparent 55%, transparent 100%)",
                  }}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
