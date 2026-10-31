"use client";

import { useEffect, useState } from "react";
import { AvailabilityManagerDesktop } from "./availability-manager-desktop";

type Tab = "schedule" | "availability";

export function CalendarPageTabs({
  coachId,
  initialWindows,
  initialTab,
  sessionLengthEnabled = false,
  initialBufferMinutes,
  sessionTypes = [],
  sessionTypeEnabled = false,
  settingsSlot = null,
  hideStripOnDesktop = false,
  children,
}: {
  coachId: string;
  initialWindows: {
    id: string;
    weekday: number;
    startTime: string;
    endTime: string;
    slotDurationMinutes: number;
    sessionMinutes?: number | null;
    sessionTypeId?: string | null;
  }[];
  // The two numbers for all the hours: how long a session lasts and the gap after it (the coach's buffer).
  sessionLengthEnabled?: boolean;
  initialBufferMinutes?: number;
  // The coach's own session types, and whether a window of hours can carry one (until the database update is applied the choice is hidden).
  sessionTypes?: { id: string; name: string }[];
  sessionTypeEnabled?: boolean;
  // Lets a deep link (e.g. the Scheduling Spot's "Edit" action) land
  // straight on Availability instead of always defaulting to Schedule.
  initialTab?: Tab;
  // The Availability tab is the ONE place for availability: the weekly hours first, then (settingsSlot, two columns) how clients book and the booking rules,
  // and the time zone, public page and time off.
  settingsSlot?: React.ReactNode;
  // FIX 6: on a computer the shell's Calendar strip has Schedule and Availability (links: ?tab=availability), so this pair shows only below lg.
  hideStripOnDesktop?: boolean;
  children: React.ReactNode;
}) {
  const [tab, setTab] = useState<Tab>(initialTab ?? "schedule");
  // The strip's links change the address, and the page comes back with the new initialTab: follow it.
  useEffect(() => {
    setTab(initialTab ?? "schedule");
  }, [initialTab]);

  return (
    <div>
      <div className={`flex items-center gap-1 border-b border-steel/20 mb-6 ${hideStripOnDesktop ? "lg:hidden" : ""}`}>
        <button
          type="button"
          onClick={() => setTab("schedule")}
          className={`h-10 px-4 font-body text-sm border-b-2 transition-colors ${
            tab === "schedule"
              ? "border-rust text-chalk"
              : "border-transparent text-steel active:text-chalk"
          }`}
        >
          Schedule
        </button>
        <button
          type="button"
          onClick={() => setTab("availability")}
          className={`h-10 px-4 font-body text-sm border-b-2 transition-colors ${
            tab === "availability"
              ? "border-rust text-chalk"
              : "border-transparent text-steel active:text-chalk"
          }`}
        >
          Availability
        </button>
      </div>

      {tab === "schedule" ? (
        children
      ) : (
        // Columns from the width the page has (layout audit, Oct 31): one on a phone, hours beside the settings at 768px, three columns from 1152px.
        <div className="grid grid-cols-1 gap-8 items-start @3xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] @6xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <AvailabilityManagerDesktop
            coachId={coachId}
            initialWindows={initialWindows.map((w) => ({ ...w, sessionMinutes: w.sessionMinutes ?? null, sessionTypeId: w.sessionTypeId ?? null }))}
            sessionLengthEnabled={sessionLengthEnabled}
            initialBufferMinutes={initialBufferMinutes}
            sessionTypes={sessionTypes}
            sessionTypeEnabled={sessionTypeEnabled}
          />
          <div className="grid grid-cols-1 gap-8 items-start min-w-0 @6xl:contents">{settingsSlot}</div>
        </div>
      )}
    </div>
  );
}
