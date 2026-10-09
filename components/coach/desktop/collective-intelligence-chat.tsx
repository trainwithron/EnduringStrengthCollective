"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { PointerEvent as ReactPointerEvent } from "react";
import { MessageCircle, ChevronRight, ChevronLeft } from "lucide-react";
import {
  readAskSpotWidgetState,
  writeAskSpotWidgetState,
  DEFAULT_ASK_SPOT_WIDGET_STATE,
} from "@/lib/ask-spot-widget-state";
import { AskSpotChatPanel } from "@/components/coach/ask-spot-chat-panel";
import { FloatingMessages } from "@/components/coach/desktop/floating-messages";
import { afterThreadOpened, badgeText, panelHeader, shownUnread } from "@/lib/floating-panel";
import { clientIdFromPath } from "@/lib/messages-list";

const MIN_BOTTOM = 88; // clears a mobile bottom tab bar (64px) + margin
const TOP_SAFE_MARGIN = 160; // keeps the tab and its open panel clear of a top-anchored control (e.g. The Spot)
const DRAG_THRESHOLD = 6; // px of pointer movement before a press counts as a drag, not a tap
const SWIPE_DISTANCE_THRESHOLD = 36; // px, horizontal — an edge-panel swipe is a short flick, not a long drag

function clampBottom(value: number): number {
  const ceiling = typeof window !== "undefined" ? window.innerHeight - TOP_SAFE_MARGIN : 600;
  return Math.min(Math.max(value, MIN_BOTTOM), Math.max(MIN_BOTTOM, ceiling));
}

// AI Assistant Phase 2 — the conversational chat companion to the
// Collective Intelligence daily briefing panel
// (collective_intelligence_phase_2_conversational_assistant.md). "A
// floating chat, alongside the dashboard cards" — general questions stay
// here, don't navigate anywhere. No streaming (resolved deliberately): the
// numeral/name guards have to see the whole answer before the coach does,
// so a brief "Checking…" state stands in for a live-typing effect.
//
// User-facing name is "Ask Spot," not "Collective Intelligence"
// (feature_redundancy_and_could_work_better_audit_sept29.md) — this is a
// different, pull-based mechanism (a coach asks a question) from the
// push-based daily digest panel, which keeps the locked "Collective
// Intelligence" name (ai_assistant_marketing_deep_dive.md). Reuses the
// app's own already-established "Spot" assistant branding rather than
// inventing a new term, so the two surfaces stop sharing one name.
//
// Desktop-only entry point. Mobile's own entry point is the Spotlight hub
// (coach-spot-hub.tsx, which has Ask Spot as one of its tiles, rendering the exact same AskSpotChatPanel content
// component below — not a second copy of the chat logic) —
// mobile_more_tab_condensed_widget_hub_sept30.md. This component itself
// stays desktop-only now; it previously also mounted standalone in
// CoachMobileShell as its own edge-tab, which that memory's decision
// explicitly absorbed into the broader drawer instead of shipping
// separately.
//
// Visual form, per Ron's own direct steer away from a Messenger-style
// floating circle: a Samsung Edge-Panel-style slim tab, always docked
// flush against one screen edge — never drifting loose over content. At
// rest it's just the tab; a tap or an outward swipe expands it into the
// full chat, and a tap or an inward swipe on the panel's own header
// collapses it straight back to the tab — one tap always gets a coach
// back to it, no settings menu to hunt through. The tab can still be
// dragged vertically along its edge to reposition it (not loose 2D drag
// — it stays snapped to the edge), and that position persists per-
// browser (lib/ask-spot-widget-state.ts) so it survives navigating to a
// new page even though this component remounts fresh on every page
// (CoachDesktopShell mounts it per-page, not in a persistent root
// layout).
export function CollectiveIntelligenceChat({ groupId, unread = 0 }: { groupId?: string; unread?: number } = {}) {
  const [open, setOpen] = useState(false);
  // The panel always opens on Spot. The Messages tab (only where there is a group to read messages for) is a quick view of who needs a reply; the client whose page the coach is on is pinned in it.
  const [tab, setTab] = useState<"spot" | "messages">("spot");
  const [messagesOpenId, setMessagesOpenId] = useState<string | null>(null);
  // Threads read in the panel since the page loaded its count: they come off the badge (on the tab and on the edge tab). A fresh count from the page starts this over.
  const [readSince, setReadSince] = useState(0);
  const [countedThreads, setCountedThreads] = useState<Set<string>>(new Set());
  useEffect(() => {
    setReadSince(0);
    setCountedThreads(new Set());
  }, [unread]);
  const unreadNow = shownUnread(unread, readSince);
  const header = panelHeader(tab);
  const viewingClientId = clientIdFromPath(usePathname());
  const [side, setSide] = useState<"left" | "right">(DEFAULT_ASK_SPOT_WIDGET_STATE.side);
  const [bottomOffset, setBottomOffset] = useState(DEFAULT_ASK_SPOT_WIDGET_STATE.bottomOffsetPx);
  const tabDrag = useRef<{ x: number; y: number; startBottom: number; moved: boolean } | null>(null);
  const headerDrag = useRef<{ x: number; moved: boolean } | null>(null);

  // Hydrated from localStorage on mount only — avoids a server/client
  // markup mismatch (the default above is what both render identically
  // before this runs).
  useEffect(() => {
    const saved = readAskSpotWidgetState("ask-spot-widget-state");
    setSide(saved.side);
    setBottomOffset(clampBottom(saved.bottomOffsetPx));
  }, []);

  // --- Tab (collapsed) gestures: vertical drag repositions along the
  // edge; a plain tap, or a short outward swipe, expands the panel.
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
    // Only a vertical drag repositions it — it never leaves the edge.
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
      setOpen(true);
      return;
    }

    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    const swipedOutward = side === "right" ? dx < -SWIPE_DISTANCE_THRESHOLD : dx > SWIPE_DISTANCE_THRESHOLD;
    if (swipedOutward && Math.abs(dx) > Math.abs(dy)) {
      setOpen(true);
    }

    // Whatever the vertical drag already settled on (live-updated during
    // move) is the real final position — persist it either way.
    const finalBottom = clampBottom(drag.startBottom - dy);
    writeAskSpotWidgetState("ask-spot-widget-state", { side, bottomOffsetPx: finalBottom });
  }

  // --- Open panel's header: a tap or an inward swipe collapses it back
  // to the tab (mirrors the tab's own open gesture, same discoverability
  // as a real Edge Panel).
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
      setOpen(false);
      return;
    }
    const dx = e.clientX - drag.x;
    const swipedInward = side === "right" ? dx > SWIPE_DISTANCE_THRESHOLD : dx < -SWIPE_DISTANCE_THRESHOLD;
    if (swipedInward) setOpen(false);
  }

  const edgeStyle: React.CSSProperties = { bottom: bottomOffset, [side]: 0 } as React.CSSProperties;
  const ChevronIcon = side === "right" ? ChevronLeft : ChevronRight;

  if (!open) {
    return (
      <button
        type="button"
        aria-label={unreadNow > 0 ? `Open Ask Spot chat, ${unreadNow} unread ${unreadNow === 1 ? "message" : "messages"}` : "Open Ask Spot chat"}
        style={edgeStyle}
        className={`fixed z-40 w-7 h-14 bg-rust/80 active:bg-rust transition-colors flex items-center justify-center touch-none select-none ${
          side === "right" ? "rounded-l-token-sm" : "rounded-r-token-sm"
        }`}
        onPointerDown={handleTabPointerDown}
        onPointerMove={handleTabPointerMove}
        onPointerUp={handleTabPointerUp}
      >
        <MessageCircle className="w-3.5 h-3.5 text-graphite" />
        {unreadNow > 0 && (
          <span className={`absolute -top-2 ${side === "right" ? "left-0" : "right-0"} h-5 min-w-[20px] px-1 rounded-full bg-chalk text-graphite font-body text-xs font-bold flex items-center justify-center shadow`}>{badgeText(unreadNow)}</span>
        )}
      </button>
    );
  }

  return (
    <div
      style={edgeStyle}
      className="fixed z-40 w-[360px] max-w-[calc(100vw-2rem)] h-[480px] max-h-[70vh] bg-graphite border border-steel/30 shadow-2xl flex flex-col"
    >
      <div
        onPointerDown={handleHeaderPointerDown}
        onPointerMove={handleHeaderPointerMove}
        onPointerUp={handleHeaderPointerUp}
        className="px-4 py-3 border-b border-steel/20 flex items-center justify-between gap-2 touch-none select-none cursor-grab shrink-0"
      >
        <div>
          <p className="font-body text-xs text-steel uppercase tracking-wide font-bold">
            {header.title}
          </p>
          <p className="font-body text-xs text-steel mt-0.5">{header.subtitle}</p>
        </div>
        <ChevronIcon
          className="w-4 h-4 text-steel shrink-0"
          aria-label={header.collapseLabel}
        />
      </div>

      {groupId && (
        <div role="tablist" aria-label="Panel" className="flex border-b border-steel/20 shrink-0">
          {(["spot", "messages"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`flex-1 h-11 font-body text-sm flex items-center justify-center gap-2 border-b-2 ${tab === t ? "border-rust text-chalk" : "border-transparent text-steel"}`}
            >
              {t === "spot" ? "Spot" : "Messages"}
              {t === "messages" && unreadNow > 0 && (
                <span className="h-5 min-w-[20px] px-1 rounded-full bg-rust text-graphite font-body text-xs font-bold flex items-center justify-center">{badgeText(unreadNow)}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Spot stays mounted (its conversation is kept) but hidden on the other tab; Messages is mounted only while it is showing, so nothing loads or is marked read while it is hidden or the panel is closed. */}
      <div className={tab === "spot" || !groupId ? "flex-1 min-h-0 flex flex-col" : "hidden"}>
        <AskSpotChatPanel />
      </div>
      {groupId && tab === "messages" && (
        <FloatingMessages
          groupId={groupId}
          viewingClientId={viewingClientId}
          openId={messagesOpenId}
          onOpenIdChange={setMessagesOpenId}
          onOpened={(otherId, threadUnread) => {
            const next = afterThreadOpened(countedThreads, readSince, otherId, threadUnread);
            setCountedThreads(next.counted);
            setReadSince(next.readSince);
          }}
        />
      )}
    </div>
  );
}
