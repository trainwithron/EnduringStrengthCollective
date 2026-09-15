"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  DEFAULT_LIST_PANEL_WIDTH,
  MIN_LIST_PANEL_WIDTH,
  MAX_LIST_PANEL_WIDTH,
  readListPanelWidth,
  writeListPanelWidth,
  readListPanelCollapsed,
  writeListPanelCollapsed,
  readListPanelView,
  writeListPanelView,
  type ListPanelView,
} from "@/lib/coach-shell-panel-storage";
import { NeedsAttentionStrip } from "./needs-attention-strip";
import { RosterMiniList } from "./roster-mini-list";
import { BusinessMiniDashboard } from "./business-mini-dashboard";
import { CalendarMiniView } from "./calendar-mini-view";
import { ProgramMiniView } from "./program-mini-view";

export interface SectionSubLink {
  key: string;
  label: string;
  href: string;
  active: boolean;
}

// The secondary panel (coach_desktop_shell_identity_redesign.md, items
// 2-4): drag-to-resize (clamped 220-560px), full collapse via a small
// edge tab that remembers the last width, and a persistent roster ⇄
// Business-mini-dashboard toggle that survives navigating the rail
// ("picture in picture," not a temporary popover) — plus the pinned
// Needs Attention strip and, when the current page belongs to a
// multi-page section, that section's own sub-links so nothing existing
// becomes unreachable.
export function ShellListPanel({
  coachId,
  groupId,
  sectionLabel,
  sectionSubLinks,
}: {
  coachId: string;
  groupId: string;
  sectionLabel: string | null;
  sectionSubLinks: SectionSubLink[];
}) {
  const [width, setWidth] = useState(DEFAULT_LIST_PANEL_WIDTH);
  const [collapsed, setCollapsed] = useState(false);
  const [view, setView] = useState<ListPanelView>("roster");
  const [dragging, setDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  useEffect(() => {
    setWidth(readListPanelWidth());
    setCollapsed(readListPanelCollapsed());
    setView(readListPanelView());
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const delta = e.clientX - dragStartX.current;
    const next = Math.min(MAX_LIST_PANEL_WIDTH, Math.max(MIN_LIST_PANEL_WIDTH, dragStartWidth.current + delta));
    setWidth(next);
  }, []);

  const handleMouseUp = useCallback(() => {
    setDragging(false);
    setWidth((w) => {
      writeListPanelWidth(w);
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
      <div className="flex-1 min-w-0 overflow-y-auto p-3">
        <NeedsAttentionStrip coachId={coachId} groupId={groupId} />

        {sectionSubLinks.length > 0 && (
          <div className="mb-3 pb-3 border-b border-steel/20">
            <p className="font-body text-[10px] text-steel uppercase tracking-wide mb-1.5 px-1">
              {sectionLabel}
            </p>
            <div className="space-y-0.5">
              {sectionSubLinks.map((link) => (
                <Link
                  key={link.key}
                  href={link.href}
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

        <div className="grid grid-cols-2 gap-1 mb-2">
          <button
            type="button"
            onClick={() => selectView("roster")}
            className={`h-7 font-body text-[11px] uppercase tracking-wide border ${
              view === "roster" ? "border-rust text-rust bg-rust/10" : "border-steel/30 text-steel"
            }`}
          >
            Clients
          </button>
          <button
            type="button"
            onClick={() => selectView("business")}
            className={`h-7 font-body text-[11px] uppercase tracking-wide border ${
              view === "business" ? "border-rust text-rust bg-rust/10" : "border-steel/30 text-steel"
            }`}
            title="Pin the Business mini-dashboard"
          >
            💰 Business
          </button>
          <button
            type="button"
            onClick={() => selectView("calendar")}
            className={`h-7 font-body text-[11px] uppercase tracking-wide border ${
              view === "calendar" ? "border-rust text-rust bg-rust/10" : "border-steel/30 text-steel"
            }`}
            title="Pin the Calendar mini-view"
          >
            📅 Calendar
          </button>
          <button
            type="button"
            onClick={() => selectView("program")}
            className={`h-7 font-body text-[11px] uppercase tracking-wide border ${
              view === "program" ? "border-rust text-rust bg-rust/10" : "border-steel/30 text-steel"
            }`}
            title="Pin a condensed Program Builder view"
          >
            🏋 Program
          </button>
        </div>

        {view === "roster" && <RosterMiniList groupId={groupId} />}
        {view === "business" && <BusinessMiniDashboard groupId={groupId} />}
        {view === "calendar" && <CalendarMiniView groupId={groupId} />}
        {view === "program" && <ProgramMiniView groupId={groupId} />}
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
