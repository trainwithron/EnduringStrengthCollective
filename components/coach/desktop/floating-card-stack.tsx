"use client";

import { useEffect, useState } from "react";
import { X, Plus } from "lucide-react";
import {
  readCardStackOrder,
  writeCardStackOrder,
  type ListPanelView,
} from "@/lib/coach-shell-panel-storage";
import { RosterMiniList } from "./roster-mini-list";
import { BusinessMiniDashboard } from "./business-mini-dashboard";
import { CalendarMiniView } from "./calendar-mini-view";
import { ProgramMiniView } from "./program-mini-view";

// cascading_card_stack_widget_layering_idea.md — the "optional floating
// card stack" alternative to ShellListPanel's traditional one-at-a-time
// tab switcher. Same four mini-views, same real estate, but 2-4 shown
// simultaneously as offset, cascaded cards (Ron's own reference: his
// wife's layered-Word-document workflow) — each card's edge stays
// visible and clickable behind the front one; clicking a back card's
// visible sliver brings it to front without closing anything else.
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
const CARD_WIDTH = 340;
const CARD_HEIGHT = 560;
const OFFSET_STEP = 28;

export function FloatingCardStack({ groupId }: { groupId: string }) {
  const [order, setOrder] = useState<ListPanelView[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setOrder(readCardStackOrder());
    setHydrated(true);
  }, []);

  function persist(next: ListPanelView[]) {
    setOrder(next);
    writeCardStackOrder(next);
  }

  function bringToFront(view: ListPanelView) {
    persist([view, ...order.filter((v) => v !== view)]);
  }

  function closeCard(view: ListPanelView) {
    persist(order.filter((v) => v !== view));
  }

  function openCard(view: ListPanelView) {
    if (order.includes(view)) {
      bringToFront(view);
      return;
    }
    persist([view, ...order]);
  }

  // Avoids a hydration flash of the default (all-4-open) order before
  // this coach's own saved preference loads from localStorage.
  if (!hydrated) return null;

  const closedViews = ALL_VIEWS.filter((v) => !order.includes(v));

  return (
    <div
      className="hidden lg:block fixed left-4 top-[72px] z-40"
      style={{ width: CARD_WIDTH + Math.max(0, order.length - 1) * OFFSET_STEP + 40 }}
    >
      {closedViews.length > 0 && (
        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
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
      )}

      {order.length === 0 ? (
        <p className="font-body text-xs text-steel">All cards closed — reopen one above.</p>
      ) : (
        <div className="relative" style={{ height: CARD_HEIGHT }}>
          {order
            .slice()
            .reverse()
            .map((view, reverseIndex) => {
              const frontIndex = order.length - 1 - reverseIndex;
              const offset = frontIndex * OFFSET_STEP;
              const isFront = frontIndex === 0;
              return (
                <div
                  key={view}
                  onClick={() => !isFront && bringToFront(view)}
                  className="absolute bg-surface border border-steel/30 rounded-token-lg shadow-[0_12px_32px_-8px_rgba(0,0,0,0.6)] overflow-hidden"
                  style={{
                    width: CARD_WIDTH,
                    left: offset,
                    top: offset,
                    zIndex: 10 + frontIndex,
                    cursor: isFront ? "default" : "pointer",
                  }}
                >
                  <div className="flex items-center justify-between px-3 h-9 border-b border-steel/20 bg-surface/60">
                    <p className="font-body text-xs uppercase tracking-wide text-steel">
                      {CARD_META[view].icon} {CARD_META[view].label}
                    </p>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        closeCard(view);
                      }}
                      aria-label={`Close ${CARD_META[view].label}`}
                      className="w-6 h-6 flex items-center justify-center text-steel active:text-rust"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="p-3 overflow-y-auto" style={{ maxHeight: CARD_HEIGHT - 36 }}>
                    {view === "roster" && <RosterMiniList groupId={groupId} />}
                    {view === "business" && <BusinessMiniDashboard groupId={groupId} />}
                    {view === "calendar" && <CalendarMiniView groupId={groupId} />}
                    {view === "program" && <ProgramMiniView groupId={groupId} />}
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
