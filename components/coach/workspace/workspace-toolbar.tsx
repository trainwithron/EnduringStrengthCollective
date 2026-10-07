"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { LayoutGrid, PanelRight, Plus } from "lucide-react";
import { tileFloating } from "@/lib/workspace-layout";
import { useWorkspace } from "./workspace-context";

// The thin bar under the top bar while anything is open: add a view, show or hide the panel, tile the cards, and restore minimized cards. It lives in a slot the
// shell keeps in the page flow (so it takes its own space and never covers the page or the rail).
export function WorkspaceToolbar() {
  const ws = useWorkspace();
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setSlot(document.getElementById("workspace-bar-slot"));
  }, []);
  if (!ws || !ws.enabled || !ws.ready || !slot) return null;
  const { dock, floating } = ws.layout;
  const dockCount = dock.panes.length;
  if (dockCount + floating.length === 0) return null;

  const minimized = floating.filter((c) => c.minimized);
  const shown = floating.filter((c) => !c.minimized);
  const btn = "h-9 px-3 shrink-0 flex items-center gap-1.5 font-body text-[13px] text-chalk border border-steel/40 bg-surface hover:border-rust";

  return createPortal(
    <div className="flex items-center gap-2 h-11 px-4 border-b border-steel/20 bg-graphite overflow-x-auto" role="toolbar" aria-label="Workspace">
      <button type="button" onClick={() => ws.setPickerOpen(true)} className={btn}>
        <Plus className="w-3.5 h-3.5" aria-hidden="true" />
        Add a view
      </button>
      {dockCount > 0 && (
        <button type="button" aria-pressed={dock.open} onClick={() => ws.dispatch({ type: "setDockOpen", open: !dock.open })} className={btn}>
          <PanelRight className="w-3.5 h-3.5" aria-hidden="true" />
          Panel ({dockCount})
        </button>
      )}
      {shown.length >= 2 && (
        <button type="button" onClick={() => ws.dispatch({ type: "replace", layout: tileFloating(ws.layout, ws.area) })} className={btn}>
          <LayoutGrid className="w-3.5 h-3.5" aria-hidden="true" />
          Tile cards
        </button>
      )}
      {minimized.map((c) => (
        <button key={c.id} type="button" onClick={() => ws.dispatch({ type: "minimize", id: c.id, minimized: false })} className={btn} title="Restore">
          {c.dest.label}
        </button>
      ))}
    </div>,
    slot
  );
}
