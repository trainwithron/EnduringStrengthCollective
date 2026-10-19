"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  MIN_LIST_PANEL_WIDTH,
  MAX_LIST_PANEL_WIDTH,
  readSplitWidth,
  writeSplitWidth,
  readListPanelCollapsed,
  writeListPanelCollapsed,
  readListPanelView,
  writeListPanelView,
  type ListPanelView,
} from "@/lib/coach-shell-panel-storage";
import { NeedsAttentionStrip } from "./needs-attention-strip";
import { PendingRequestsLine } from "./pending-requests-line";
import { SplitHalfSlot } from "./split-half";

export interface SectionSubLink {
  key: string;
  label: string;
  href: string;
  active: boolean;
  // Opens in a new tab (Display Mode: a screen on a wall or a TV must not replace the coach's own tab).
  newTab?: boolean;
}

// The secondary panel (coach_desktop_shell_identity_redesign.md, items
// 2-4): drag-to-resize (clamped 220-560px), full collapse via a small
// edge tab that remembers the last width, and a persistent roster ⇄
// Business-mini-dashboard toggle that survives navigating the rail
// ("picture in picture," not a temporary popover) — plus the pinned
// Needs Attention strip and, when the current page belongs to a
// multi-page section, that section's own sub-links so nothing existing
// becomes unreachable.
//
// Split screen (Ron, Oct 19: "If you click Business, it should pull up the full Business page in that half, or Clients, it should pull up your full client list"): each tile shows its section's FULL
// page below the tiles, in a frame of its own (the same frame the workspace panes use: the app's own pages only, drawn without the app's chrome, and links inside stay inside the half, so Build a program
// builds there). The page on the other side is never touched. The panel opens at half the window; a dragged width is remembered. The frames themselves live in the coach layout (split-half.tsx) so they
// survive the other side changing pages; each tile keeps its page (and its place in it) while another is shown.
export function ShellListPanel({
  coachId,
  groupId,
  groupName,
  sectionLabel,
  sectionSubLinks,
  hideMoney = false,
}: {
  coachId: string;
  groupId: string;
  groupName: string;
  sectionLabel: string | null;
  sectionSubLinks: SectionSubLink[];
  /** a team-sport group, or an organization that is all team-sport groups, has no money numbers (lib/team-sport.ts, moneyHiddenFor): no Business tile, no Business view (even one pinned earlier), no income / MRR / paying-client tiles */
  hideMoney?: boolean;
}) {
  const [width, setWidth] = useState(MIN_LIST_PANEL_WIDTH);
  const [collapsed, setCollapsed] = useState(false);
  const [pickedView, setView] = useState<ListPanelView>("roster");
  // a Business view pinned earlier (in another group) never shows where the money numbers are hidden
  const view: ListPanelView = hideMoney && pickedView === "business" ? "roster" : pickedView;
  const [dragging, setDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  useEffect(() => {
    setWidth(readSplitWidth(window.innerWidth));
    setCollapsed(readListPanelCollapsed());
    setView(readListPanelView());
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const delta = e.clientX - dragStartX.current;
    // Real viewport ceiling, not just the static MAX — leaves room for
    // the 64px icon rail plus a real sliver of main content (200px)
    // rather than letting the panel swallow the whole window.
    const viewportMax = Math.max(MIN_LIST_PANEL_WIDTH, window.innerWidth - 64 - 200);
    const next = Math.min(MAX_LIST_PANEL_WIDTH, viewportMax, Math.max(MIN_LIST_PANEL_WIDTH, dragStartWidth.current + delta));
    setWidth(next);
  }, []);

  const handleMouseUp = useCallback(() => {
    setDragging(false);
    setWidth((w) => {
      writeSplitWidth(w);
      return w;
    });
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", handleMouseUp);
  }, [handleMouseMove]);

  function startDrag(e: React.MouseEvent) {
    dragStartX.current = e.clientX;
    dragStartWidth.current = width;
    setDragging(true);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }

  useEffect(() => {
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      writeListPanelCollapsed(next);
      return next;
    });
  }

  function selectView(next: ListPanelView) {
    setView(next);
    writeListPanelView(next);
  }

  if (collapsed) {
    return (
      <div className="hidden lg:flex shrink-0 border-r border-steel/20 sticky top-14 h-[calc(100vh-56px)] items-start">
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label="Expand panel"
          title="Expand panel"
          className="w-4 h-11 mt-3 flex items-center justify-center border border-steel/30 border-l-0 bg-graphite text-steel active:text-chalk"
        >
          <ChevronRight className="w-3 h-3" />
        </button>
      </div>
    );
  }

  return (
    <div
      className="hidden lg:flex shrink-0 border-r border-steel/20 sticky top-14 h-[calc(100vh-56px)] relative"
      style={{ width }}
    >
      <div className="flex-1 min-w-0 flex flex-col">
      <div className="shrink-0 max-h-[45%] overflow-y-auto p-3 pb-0">
        <NeedsAttentionStrip coachId={coachId} groupId={groupId} />
        <PendingRequestsLine groupId={groupId} />

        {sectionSubLinks.length > 0 && (
          <div className="mb-3 pb-3 border-b border-steel/20">
            <p className="font-body text-xs text-steel uppercase tracking-wide mb-1.5 px-1">
              {sectionLabel}
            </p>
            <div className="space-y-0.5">
              {sectionSubLinks.map((link) => (
                <Link
                  key={link.key}
                  href={link.href}
                  {...(link.newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  className={`block px-2 py-1.5 font-body text-sm transition-colors ${
                    link.active ? "text-rust bg-rust/10" : "text-steel active:text-chalk"
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className={`grid ${hideMoney ? "grid-cols-3" : "grid-cols-2"} gap-1 mb-2`}>
          <button
            type="button"
            onClick={() => selectView("roster")}
            className={`h-7 font-body text-xs uppercase tracking-wide border ${
              view === "roster" ? "border-rust text-rust bg-rust/10" : "border-steel/30 text-steel"
            }`}
          >
            Clients
          </button>
          {!hideMoney && (
          <button
            type="button"
            onClick={() => selectView("business")}
            className={`h-7 font-body text-xs uppercase tracking-wide border ${
              view === "business" ? "border-rust text-rust bg-rust/10" : "border-steel/30 text-steel"
            }`}
            title="Your Business page, in this half"
          >
            💰 Business
          </button>
          )}
          <button
            type="button"
            onClick={() => selectView("calendar")}
            className={`h-7 font-body text-xs uppercase tracking-wide border ${
              view === "calendar" ? "border-rust text-rust bg-rust/10" : "border-steel/30 text-steel"
            }`}
            title="Your Calendar, in this half"
          >
            📅 Calendar
          </button>
          <button
            type="button"
            onClick={() => selectView("program")}
            className={`h-7 font-body text-xs uppercase tracking-wide border ${
              view === "program" ? "border-rust text-rust bg-rust/10" : "border-steel/30 text-steel"
            }`}
            title="Your programs, in this half: build one here while the other side stays put"
          >
            🏋 Program
          </button>
        </div>

      </div>
        {/* The full page of the picked tile (hideMoney never shows Business: `view` is already roster there). */}
        <div className="flex-1 min-h-0 flex flex-col border-t border-steel/20 mt-2">
          <SplitHalfSlot view={view} groupId={groupId} covered={dragging} />
        </div>
      </div>

      {/* Drag-to-resize edge + full-collapse tab (item 3-4). */}
      <div
        onMouseDown={startDrag}
        className={`w-1 shrink-0 cursor-col-resize hover:bg-rust/40 transition-colors ${
          dragging ? "bg-rust/50" : "bg-transparent"
        }`}
      />
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-label="Collapse panel"
        title="Collapse panel"
        className="absolute -right-4 top-3 w-4 h-11 flex items-center justify-center border border-steel/30 border-l-0 bg-graphite text-steel active:text-chalk z-10"
      >
        <ChevronLeft className="w-3 h-3" />
      </button>
    </div>
  );
}
