"use client";

import { PanelRight } from "lucide-react";
import { useWorkspace } from "./workspace-context";

// The rail's way in: opens "Add a view". (It replaced the old toggle between the left panel and the floating card stack; the left panel stays, and the workspace
// panel and cards are added beside the page.)
export function WorkspaceRailButton() {
  const ws = useWorkspace();
  if (!ws || !ws.enabled) return null;
  const count = ws.layout.dock.panes.length + ws.layout.floating.length;
  return (
    <button
      type="button"
      onClick={() => ws.setPickerOpen(true)}
      aria-label="Add a view next to this page"
      title="Add a view next to this page (a page, or a client)"
      className="relative w-11 h-11 flex items-center justify-center text-steel active:text-chalk"
    >
      <PanelRight className="w-4 h-4" strokeWidth={2.25} />
      {count > 0 && <span className="absolute top-1 right-1.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-rust text-graphite font-body text-[10px] font-bold flex items-center justify-center">{count}</span>}
    </button>
  );
}
