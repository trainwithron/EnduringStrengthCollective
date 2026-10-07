"use client";

import { useRef } from "react";
import { ArrowUpRight, ExternalLink, X } from "lucide-react";
import { DOCK_MAX_WIDTH, DOCK_MIN_WIDTH } from "@/lib/workspace-layout";
import { PaneFrame } from "./pane-frame";
import { TOP_OFFSET, useWorkspace } from "./workspace-context";

// The workspace's panel: beside the page, fixed to the right edge (the page keeps that much room clear: the shell's main reads --ws-dock). Each pane is a tab; the tab
// you are not looking at stays loaded (so a half-typed note or a scroll position is still there when you come back), and a tab never opened yet loads nothing. The
// edge between the page and the panel is a divider: drag it, or focus it and use the arrow keys. Left and Right move between tabs.
export function WorkspaceDock() {
  const ws = useWorkspace();
  const dragRef = useRef<{ pointerId: number } | null>(null);
  if (!ws || !ws.enabled || !ws.ready || ws.dockWidth === 0) return null;
  const { dock } = ws.layout;
  const width = ws.dockWidth;

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
  const activeIndex = dock.panes.findIndex((p) => p.id === active.id);

  // Arrow keys move between tabs (roving focus): only the selected tab is in the tab order.
  function onTabKey(e: React.KeyboardEvent) {
    if (!ws) return;
    let next = activeIndex;
    if (e.key === "ArrowRight") next = (activeIndex + 1) % dock.panes.length;
    else if (e.key === "ArrowLeft") next = (activeIndex - 1 + dock.panes.length) % dock.panes.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = dock.panes.length - 1;
    else return;
    e.preventDefault();
    ws.dispatch({ type: "activate", id: dock.panes[next].id });
    requestAnimationFrame(() => document.getElementById(`workspace-tab-${dock.panes[next].id}`)?.focus());
  }

  const small = "w-9 h-10 shrink-0 flex items-center justify-center text-steel hover:text-chalk";
  return (
    <aside aria-label="Workspace panel" className="hidden lg:flex fixed right-0 z-30 flex-col border-l border-steel/20 bg-graphite" style={{ width, top: TOP_OFFSET, height: `calc(100vh - ${TOP_OFFSET}px)` }}>
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
      <div className="flex items-end border-b border-steel/20 pl-2 shrink-0">
        <div role="tablist" aria-label="Open in the panel" onKeyDown={onTabKey} className="flex items-end gap-1 overflow-x-auto flex-1 min-w-0">
          {dock.panes.map((pane) => {
            const selected = pane.id === active.id;
            return (
              <button
                key={pane.id}
                id={`workspace-tab-${pane.id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls="workspace-tabpanel"
                tabIndex={selected ? 0 : -1}
                onClick={() => ws.dispatch({ type: "activate", id: pane.id })}
                className={`h-10 px-3 shrink-0 max-w-[170px] truncate font-body text-[13px] border-b-2 -mb-px ${selected ? "border-rust text-chalk" : "border-transparent text-steel hover:text-chalk"}`}
              >
                {pane.dest.label}
              </button>
            );
          })}
        </div>
        <button type="button" onClick={() => ws.dispatch({ type: "toFloating", id: active.id, bounds: ws.area })} aria-label={`Make ${active.dest.label} a floating card`} title="Float as a card" className={small}>
          <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
        <a href={active.dest.path} target="_blank" rel="noopener noreferrer" aria-label={`Open ${active.dest.label} as a full page`} title="Open as a full page" className={`${small} flex`}>
          <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
        </a>
        <button type="button" onClick={() => ws.requestClose(active.id)} aria-label={`Close ${active.dest.label}`} title="Close" className="w-9 h-10 shrink-0 flex items-center justify-center text-steel hover:text-rust">
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
      <div id="workspace-tabpanel" role="tabpanel" aria-labelledby={`workspace-tab-${active.id}`} className="flex-1 min-h-0 flex flex-col">
        {dock.panes.map((pane) => (
          <PaneFrame key={pane.id} pane={pane} hidden={pane.id !== active.id} />
        ))}
      </div>
    </aside>
  );
}
