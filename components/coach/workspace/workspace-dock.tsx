"use client";

import { useRef } from "react";
import { ArrowUpRight, ExternalLink, X } from "lucide-react";
import { DOCK_MAX_WIDTH, DOCK_MIN_WIDTH } from "@/lib/workspace-layout";
import { PaneFrame } from "./pane-frame";
import { RAIL_WIDTH, TOP_OFFSET, useWorkspace } from "./workspace-context";

// The workspace's panel: beside the page, on the right. Each pane is a tab; the tab you are not looking at stays loaded (so a half-typed note or a scroll position
// is still there when you come back). The edge between the page and the panel is a divider: drag it, or focus it and use the arrow keys.
export function WorkspaceDock() {
  const ws = useWorkspace();
  const dragRef = useRef<{ pointerId: number } | null>(null);
  if (!ws || !ws.enabled || !ws.ready) return null;
  const { dock } = ws.layout;
  if (!dock.open || dock.panes.length === 0) return null;
  const width = Math.min(dock.width, Math.max(DOCK_MIN_WIDTH, ws.viewportWidth - RAIL_WIDTH - 360));

  function onDividerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { pointerId: e.pointerId };
  }
  function onDividerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current || !ws) return;
    ws.dispatch({ type: "setDockWidth", width: window.innerWidth - e.clientX });
  }
  function onDividerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current) e.currentTarget.releasePointerCapture(dragRef.current.pointerId);
    dragRef.current = null;
  }
  function onDividerKey(e: React.KeyboardEvent) {
    if (!ws) return;
    const step = e.shiftKey ? 80 : 20;
    if (e.key === "ArrowLeft") ws.dispatch({ type: "setDockWidth", width: width + step });
    else if (e.key === "ArrowRight") ws.dispatch({ type: "setDockWidth", width: width - step });
    else if (e.key === "Home") ws.dispatch({ type: "setDockWidth", width: DOCK_MAX_WIDTH });
    else if (e.key === "End") ws.dispatch({ type: "setDockWidth", width: DOCK_MIN_WIDTH });
    else return;
    e.preventDefault();
  }

  const active = dock.panes.find((p) => p.id === dock.activeId) ?? dock.panes[0];

  return (
    <aside
      aria-label="Workspace panel"
      className="hidden lg:flex relative shrink-0 flex-col border-l border-steel/20 bg-graphite sticky self-start"
      style={{ width, top: TOP_OFFSET, height: `calc(100vh - ${TOP_OFFSET}px)` }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the panel"
        aria-valuemin={DOCK_MIN_WIDTH}
        aria-valuemax={DOCK_MAX_WIDTH}
        aria-valuenow={Math.round(width)}
        tabIndex={0}
        onPointerDown={onDividerDown}
        onPointerMove={onDividerMove}
        onPointerUp={onDividerUp}
        onKeyDown={onDividerKey}
        className="absolute left-0 top-0 bottom-0 w-2 -ml-1 z-10 cursor-col-resize hover:bg-rust/40 focus:bg-rust/60 focus:outline-none touch-none"
      />
      <div role="tablist" aria-label="Open in the panel" className="flex items-end gap-1 overflow-x-auto border-b border-steel/20 px-2 pt-1 shrink-0">
        {dock.panes.map((pane) => {
          const selected = pane.id === active.id;
          return (
            <div key={pane.id} className={`flex items-center shrink-0 border-b-2 -mb-px ${selected ? "border-rust" : "border-transparent"}`}>
              <button
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => ws.dispatch({ type: "activate", id: pane.id })}
                className={`h-10 pl-3 pr-1 font-body text-[13px] max-w-[160px] truncate ${selected ? "text-chalk" : "text-steel hover:text-chalk"}`}
              >
                {pane.dest.label}
              </button>
              <button type="button" onClick={() => ws.dispatch({ type: "toFloating", id: pane.id, bounds: ws.area })} aria-label={`Make ${pane.dest.label} a floating card`} title="Float as a card" className="w-7 h-10 flex items-center justify-center text-steel hover:text-chalk">
                <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              <button type="button" onClick={() => ws.requestClose(pane.id)} aria-label={`Close ${pane.dest.label}`} title="Close" className="w-7 h-10 flex items-center justify-center text-steel hover:text-rust">
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          );
        })}
        <a href={active.dest.path} target="_blank" rel="noopener noreferrer" aria-label={`Open ${active.dest.label} as a full page`} title="Open as a full page" className="ml-auto w-9 h-10 shrink-0 flex items-center justify-center text-steel hover:text-chalk">
          <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
        </a>
      </div>
      <div role="tabpanel" aria-label={active.dest.label} className="flex-1 min-h-0 flex flex-col">
        {dock.panes.map((pane) => (
          <PaneFrame key={pane.id} pane={pane} hidden={pane.id !== active.id} />
        ))}
      </div>
    </aside>
  );
}
