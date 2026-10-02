"use client";

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { MessageCircle, X, Send } from "lucide-react";
import {
  readAskSpotWidgetState,
  writeAskSpotWidgetState,
  DEFAULT_ASK_SPOT_WIDGET_STATE,
} from "@/lib/ask-spot-widget-state";

interface ChatMessage {
  role: "coach" | "assistant";
  body: string;
}

const BUBBLE_SIZE = 56; // px, matches w-14 h-14
const EDGE_MARGIN = 24; // px, matches the original right-6/bottom-6 offset
const MIN_BOTTOM = 88; // clears a mobile bottom tab bar (64px) + margin
const TOP_SAFE_MARGIN = 160; // keeps both the bubble and its open panel clear of a top-anchored control (e.g. The Spot)
const DRAG_THRESHOLD = 6; // px of pointer movement before a press counts as a drag, not a tap
const SWIPE_VELOCITY_THRESHOLD = 0.5; // px/ms
const SWIPE_DISTANCE_THRESHOLD = 50; // px, horizontal

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
// CoachDesktopShell and CoachMobileShell, and genuinely
// draggable/dockable on either: Messenger-chat-heads-style drag (follows
// the pointer, snaps to the nearer edge on release) plus a real swipe-to-
// dismiss (a fast horizontal flick) that collapses it to a small,
// hidden-by-default edge handle rather than losing it outright — a coach
// can always get back to it with one tap, never a trip to a settings
// menu. Position/dock state persists per-browser (lib/ask-spot-widget-
// state.ts) so a dragged spot survives navigating to a new page, even
// though this component itself remounts fresh on every page (both coach
// shells are mounted per-page, not in a persistent root layout).
export function CollectiveIntelligenceChat() {
  const [open, setOpen] = useState(false);
  const [docked, setDocked] = useState(DEFAULT_ASK_SPOT_WIDGET_STATE.docked);
  const [side, setSide] = useState<"left" | "right">(DEFAULT_ASK_SPOT_WIDGET_STATE.side);
  const [bottomOffset, setBottomOffset] = useState(DEFAULT_ASK_SPOT_WIDGET_STATE.bottomOffsetPx);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; y: number; time: number; moved: boolean } | null>(null);

  // Hydrated from localStorage on mount only — avoids a server/client
  // markup mismatch (the default above is what both render identically
  // before this runs).
  useEffect(() => {
    const saved = readAskSpotWidgetState();
    setSide(saved.side);
    setBottomOffset(clampBottom(saved.bottomOffsetPx));
    setDocked(saved.docked);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, sending]);

  function handlePointerDown(e: ReactPointerEvent<HTMLButtonElement>) {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Unsupported/invalid pointer id — drag still tracks via the
      // bubbled move/up handlers below, same fallback already used by
      // exercise-swipe-carousel.tsx's own scrubber.
    }
    dragStart.current = { x: e.clientX, y: e.clientY, time: Date.now(), moved: false };
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragStart.current;
    if (!drag || e.buttons === 0) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
      drag.moved = true;
    }
    if (drag.moved) {
      setDragPos({ x: e.clientX, y: e.clientY });
    }
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragStart.current;
    dragStart.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // No-op if it was never captured.
    }
    if (!drag) return;

    if (!drag.moved) {
      // A real tap, not a drag — open/close as normal.
      setOpen((v) => !v);
      return;
    }

    setDragPos(null);
    const dx = e.clientX - drag.x;
    const dt = Math.max(1, Date.now() - drag.time);
    const velocityX = Math.abs(dx) / dt;
    const isSwipe = velocityX > SWIPE_VELOCITY_THRESHOLD && Math.abs(dx) > SWIPE_DISTANCE_THRESHOLD;

    const newSide: "left" | "right" = e.clientX < window.innerWidth / 2 ? "left" : "right";
    const newBottom = clampBottom(window.innerHeight - e.clientY - BUBBLE_SIZE / 2);

    setSide(newSide);
    setBottomOffset(newBottom);
    setDocked(isSwipe);
    writeAskSpotWidgetState({ side: newSide, bottomOffsetPx: newBottom, docked: isSwipe });
  }

  function handleUndock() {
    setDocked(false);
    writeAskSpotWidgetState({ side, bottomOffsetPx: bottomOffset, docked: false });
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

  // hidden_by_default_config_design_principle.md — "swiped away" collapses
  // to this small edge-docked handle rather than disappearing outright;
  // one tap always brings it straight back, no settings menu to hunt
  // through.
  if (docked) {
    return (
      <button
        type="button"
        onClick={handleUndock}
        aria-label="Open Ask Spot chat"
        style={{ bottom: bottomOffset, [side]: 0 } as React.CSSProperties}
        className={`fixed z-40 w-3.5 h-12 bg-rust/60 active:bg-rust transition-colors ${
          side === "right" ? "rounded-l-token-sm" : "rounded-r-token-sm"
        }`}
      />
    );
  }

  const positionStyle: React.CSSProperties = dragPos
    ? { left: dragPos.x - BUBBLE_SIZE / 2, top: dragPos.y - BUBBLE_SIZE / 2 }
    : { bottom: bottomOffset, [side]: EDGE_MARGIN };
  const panelPositionStyle: React.CSSProperties = { bottom: bottomOffset + BUBBLE_SIZE + 8, [side]: EDGE_MARGIN };

  return (
    <>
      <button
        type="button"
        aria-label={open ? "Close Ask Spot chat" : "Open Ask Spot chat"}
        style={positionStyle}
        className={`fixed z-40 w-14 h-14 rounded-full bg-rust text-graphite flex items-center justify-center shadow-lg active:opacity-80 touch-none select-none ${
          dragPos ? "" : "transition-[left,right,top,bottom] duration-200"
        }`}
        {...(open
          ? { onClick: () => setOpen(false) }
          : {
              onPointerDown: handlePointerDown,
              onPointerMove: handlePointerMove,
              onPointerUp: handlePointerUp,
            })}
      >
        {open ? <X className="w-6 h-6" /> : <MessageCircle className="w-6 h-6" />}
      </button>

      {open && (
        <div
          style={panelPositionStyle}
          className="fixed z-40 w-[360px] max-w-[calc(100vw-3rem)] h-[480px] max-h-[70vh] bg-graphite border border-steel/30 shadow-2xl flex flex-col"
        >
          <div className="px-4 py-3 border-b border-steel/20">
            <p className="font-body text-[10px] text-steel uppercase tracking-wide font-bold">
              Ask Spot
            </p>
            <p className="font-body text-[11px] text-steel mt-0.5">Ask about a specific client or exercise.</p>
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
      )}
    </>
  );
}
