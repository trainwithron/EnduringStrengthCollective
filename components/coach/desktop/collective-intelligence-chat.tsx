"use client";

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { MessageCircle, ChevronRight, ChevronLeft, Send } from "lucide-react";
import {
  readAskSpotWidgetState,
  writeAskSpotWidgetState,
  DEFAULT_ASK_SPOT_WIDGET_STATE,
} from "@/lib/ask-spot-widget-state";

interface ChatMessage {
  role: "coach" | "assistant";
  body: string;
}

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
// Mobile parity pass — this used to be `hidden lg:flex`, desktop-only,
// with no way to reach it from a phone at all. Now mounted in both
// CoachDesktopShell and CoachMobileShell.
//
// Visual form, revised per Ron's own direct steer away from a Messenger-
// style floating circle: a Samsung Edge-Panel-style slim tab, always
// docked flush against one screen edge — never drifting loose over
// content. At rest it's just the tab; a tap or an outward swipe expands
// it into the full chat, and a tap or an inward swipe on the panel's own
// header collapses it straight back to the tab — one tap always gets a
// coach back to it, no settings menu to hunt through. The tab can still
// be dragged vertically along its edge to reposition it (not loose 2D
// drag — it stays snapped to the edge), and that position persists per-
// browser (lib/ask-spot-widget-state.ts) so it survives navigating to a
// new page even though this component remounts fresh on every page (both
// coach shells mount it per-page, not in a persistent root layout).
// Deliberately a single fixed entry point, not a multi-slot dock — that
// wasn't asked for.
export function CollectiveIntelligenceChat() {
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<"left" | "right">(DEFAULT_ASK_SPOT_WIDGET_STATE.side);
  const [bottomOffset, setBottomOffset] = useState(DEFAULT_ASK_SPOT_WIDGET_STATE.bottomOffsetPx);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tabDrag = useRef<{ x: number; y: number; startBottom: number; moved: boolean } | null>(null);
  const headerDrag = useRef<{ x: number; moved: boolean } | null>(null);

  // Hydrated from localStorage on mount only — avoids a server/client
  // markup mismatch (the default above is what both render identically
  // before this runs).
  useEffect(() => {
    const saved = readAskSpotWidgetState();
    setSide(saved.side);
    setBottomOffset(clampBottom(saved.bottomOffsetPx));
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, sending]);

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
    writeAskSpotWidgetState({ side, bottomOffsetPx: finalBottom });
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

  async function handleSend() {
    const question = input.trim();
    if (!question || sending) return;
    setInput("");
    setError(null);
    setMessages((prev) => [...prev, { role: "coach", body: question }]);
    setSending(true);

    try {
      const response = await fetch("/api/collective-intelligence/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId, message: question }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? "Something went wrong.");
      }
      const data = await response.json();
      setThreadId(data.threadId);
      setMessages((prev) => [...prev, { role: "assistant", body: data.answer }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong — try again.");
    } finally {
      setSending(false);
    }
  }

  const edgeStyle: React.CSSProperties = { bottom: bottomOffset, [side]: 0 } as React.CSSProperties;
  const ChevronIcon = side === "right" ? ChevronLeft : ChevronRight;

  if (!open) {
    return (
      <button
        type="button"
        aria-label="Open Ask Spot chat"
        style={edgeStyle}
        className={`fixed z-40 w-7 h-14 bg-rust/80 active:bg-rust transition-colors flex items-center justify-center touch-none select-none ${
          side === "right" ? "rounded-l-token-sm" : "rounded-r-token-sm"
        }`}
        onPointerDown={handleTabPointerDown}
        onPointerMove={handleTabPointerMove}
        onPointerUp={handleTabPointerUp}
      >
        <MessageCircle className="w-3.5 h-3.5 text-graphite" />
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
        className="px-4 py-3 border-b border-steel/20 flex items-center justify-between gap-2 touch-none select-none cursor-grab"
      >
        <div>
          <p className="font-body text-[10px] text-steel uppercase tracking-wide font-bold">
            Ask Spot
          </p>
          <p className="font-body text-[11px] text-steel mt-0.5">Ask about a specific client or exercise.</p>
        </div>
        <ChevronIcon
          className="w-4 h-4 text-steel shrink-0"
          aria-label="Collapse Ask Spot chat"
        />
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <p className="font-body text-xs text-steel">
            Try: &quot;How has Alice&apos;s squat been trending?&quot; or &quot;When did Ben last log a workout?&quot;
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "coach" ? "text-right" : "text-left"}>
            <p
              className={`inline-block font-body text-sm px-3 py-2 max-w-[85%] ${
                m.role === "coach" ? "bg-rust text-graphite" : "bg-surface text-chalk"
              }`}
            >
              {m.body}
            </p>
          </div>
        ))}
        {sending && <p className="font-body text-xs text-steel">Checking…</p>}
        {error && <p className="font-body text-xs text-rust">{error}</p>}
      </div>

      <div className="p-3 border-t border-steel/20 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSend();
          }}
          placeholder="Ask a question…"
          className="flex-1 h-9 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={sending || !input.trim()}
          className="h-9 w-9 flex items-center justify-center bg-rust text-graphite disabled:opacity-40"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
