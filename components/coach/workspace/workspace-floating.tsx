"use client";

import { useRef } from "react";
import { ArrowDownLeft, ExternalLink, Minus, PanelLeft, PanelRight, X } from "lucide-react";
import { snapRect, type FloatingPane } from "@/lib/workspace-layout";
import { PaneFrame } from "./pane-frame";
import { RAIL_WIDTH, TOP_OFFSET, useWorkspace } from "./workspace-context";

const TITLE_HEIGHT = 36;

// The workspace's floating cards: each is a window over the page, to the right of the rail and under the toolbar. Drag the title bar (or focus it and use the arrow
// keys; Alt+arrows resize), snap to the left half, right half or the whole area, dock it back into the panel, minimize it to the toolbar, or open it as a full page.
export function WorkspaceFloating() {
  const ws = useWorkspace();
  if (!ws || !ws.enabled || !ws.ready || ws.layout.floating.length === 0) return null;
  // With no coach page on screen the cards are hidden, not unmounted (what is loaded in them stays).
  const { floating } = ws.layout;
  return (
    <div className={`${ws.suspended ? "hidden" : "hidden lg:block"} fixed z-40 pointer-events-none`} style={{ left: RAIL_WIDTH, top: TOP_OFFSET, width: ws.area.width, height: ws.area.height }}>
      {floating.map((card, index) => (
        <Card key={card.id} card={card} z={10 + index} />
      ))}
    </div>
  );
}

function Card({ card, z }: { card: FloatingPane; z: number }) {
  const ws = useWorkspace()!;
  const drag = useRef<{ kind: "move" | "resize"; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number } | null>(null);
  const bounds = ws.area;

  function start(kind: "move" | "resize", e: React.PointerEvent<HTMLElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    ws.dispatch({ type: "raise", id: card.id });
    drag.current = { kind, sx: e.clientX, sy: e.clientY, ox: card.x, oy: card.y, ow: card.w, oh: card.h };
  }
  function move(e: React.PointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d) return;
    if (d.kind === "move") ws.dispatch({ type: "move", id: card.id, x: d.ox + e.clientX - d.sx, y: d.oy + e.clientY - d.sy, bounds });
    else ws.dispatch({ type: "resize", id: card.id, w: d.ow + e.clientX - d.sx, h: d.oh + e.clientY - d.sy, bounds });
  }
  function end(e: React.PointerEvent<HTMLElement>) {
    if (drag.current) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // already released
      }
    }
    drag.current = null;
  }
  function snap(side: "left" | "right" | "full") {
    const r = snapRect(side, bounds);
    ws.dispatch({ type: "move", id: card.id, x: r.x, y: r.y, bounds });
    ws.dispatch({ type: "resize", id: card.id, w: r.w, h: r.h, bounds });
  }
  function onKey(e: React.KeyboardEvent) {
    const step = e.shiftKey ? 64 : 16;
    const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
    const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
    if (!dx && !dy) return;
    e.preventDefault();
    if (e.altKey) ws.dispatch({ type: "resize", id: card.id, w: card.w + dx, h: card.h + dy, bounds });
    else ws.dispatch({ type: "move", id: card.id, x: card.x + dx, y: card.y + dy, bounds });
  }

  const btn = "w-7 h-7 flex items-center justify-center text-steel hover:text-chalk";
  return (
    <section
      aria-label={card.dest.label}
      onPointerDown={() => ws.dispatch({ type: "raise", id: card.id })}
      className="absolute pointer-events-auto flex flex-col bg-surface border border-steel/30 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.6)] overflow-hidden"
      style={{ left: card.x, top: card.y, width: card.w, height: card.minimized ? TITLE_HEIGHT : card.h, zIndex: z }}
    >
      <div
        tabIndex={0}
        role="group"
        aria-label={`${card.dest.label} card. Arrow keys move it, Alt and arrow keys resize it.`}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button, a")) return;
          start("move", e);
        }}
        onPointerMove={move}
        onPointerUp={end}
        onKeyDown={onKey}
        className="flex items-center gap-1 px-2 shrink-0 border-b border-steel/20 bg-surface/60 cursor-move select-none touch-none focus:outline-none focus:ring-1 focus:ring-rust"
        style={{ height: TITLE_HEIGHT }}
      >
        <p className="font-body text-[13px] text-chalk truncate flex-1 pointer-events-none">{card.dest.label}</p>
        <button type="button" onClick={() => snap("left")} aria-label="Snap to the left half" title="Left half" className={btn}>
          <PanelLeft className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
        <button type="button" onClick={() => snap("right")} aria-label="Snap to the right half" title="Right half" className={btn}>
          <PanelRight className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
        <button type="button" onClick={() => ws.dispatch({ type: "toDock", id: card.id })} aria-label={`Put ${card.dest.label} in the panel`} title="Put in the panel" className={btn}>
          <ArrowDownLeft className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
        <a href={card.dest.path} target="_blank" rel="noopener noreferrer" aria-label={`Open ${card.dest.label} as a full page`} title="Open as a full page" className={btn}>
          <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
        </a>
        <button type="button" onClick={() => ws.dispatch({ type: "minimize", id: card.id, minimized: !card.minimized })} aria-label={card.minimized ? "Restore" : "Minimize"} title={card.minimized ? "Restore" : "Minimize"} className={btn}>
          <Minus className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
        <button type="button" onClick={() => ws.requestClose(card.id)} aria-label={`Close ${card.dest.label}`} title="Close" className="w-7 h-7 flex items-center justify-center text-steel hover:text-rust">
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
      {!card.minimized && (
        <>
          <div className="flex-1 min-h-0 flex flex-col">
            <PaneFrame pane={card} />
          </div>
          <div
            aria-hidden="true"
            onPointerDown={(e) => start("resize", e)}
            onPointerMove={move}
            onPointerUp={end}
            className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize touch-none"
            style={{ background: "linear-gradient(135deg, transparent 0%, transparent 45%, rgba(255,255,255,0.25) 50%, transparent 55%, transparent 100%)" }}
          />
        </>
      )}
    </section>
  );
}
