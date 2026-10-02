"use client";

import { X } from "lucide-react";
import { CoachNavLinksList } from "./coach-nav-links-list";

// The coach mobile "More" sheet (coach_mobile_app_redesign_plan.md,
// locked 2026-09-14) — everything the old flat drawer nav used to hold,
// minus the four destinations that are now real bottom tabs (Home,
// Roster, Messages, Calendar). Still CoachDesktopShell's own narrow-
// width "More" fallback (coach-desktop-shell.tsx) — CoachMobileShell's
// own "More" tab now opens CoachMoreDrawer instead
// (mobile_more_tab_condensed_widget_hub_sept30.md), which reuses the
// same CoachNavLinksList content below its tile row rather than nesting
// this whole overlay (with its own backdrop) inside that one.
export function CoachMoreSheet({
  groupId,
  groupName,
  onClose,
}: {
  groupId: string;
  groupName: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-graphite/80" onClick={onClose} aria-hidden="true" />
      <aside className="relative w-[280px] max-w-[85vw] h-full bg-graphite border-r border-steel/20 flex flex-col overflow-y-auto">
        <div className="flex items-center justify-between px-3 h-14 border-b border-steel/20 shrink-0">
          <p className="font-display uppercase text-sm tracking-wide text-chalk px-2">More</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 flex items-center justify-center text-steel"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <CoachNavLinksList groupId={groupId} groupName={groupName} />
      </aside>
    </div>
  );
}
