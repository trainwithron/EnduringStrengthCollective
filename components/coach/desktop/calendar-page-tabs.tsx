"use client";

import { useState } from "react";
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
  timeOffSlot = null,
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
  // The same three numbers as the Availability page: how often a start is offered, how long a session lasts, and the gap between sessions.
  sessionLengthEnabled?: boolean;
  initialBufferMinutes?: number;
  // The coach's own session types, and whether a window of hours can carry one (until the database update is applied the choice is hidden).
  sessionTypes?: { id: string; name: string }[];
  sessionTypeEnabled?: boolean;
  // Lets a deep link (e.g. the Scheduling Spot's "Edit" action) land
  // straight on Availability instead of always defaulting to Schedule.
  initialTab?: Tab;
  // The Availability tab is the ONE place for availability: how clients book and the booking rules first (settingsSlot), then the recurring hours, then time off (timeOffSlot).
  settingsSlot?: React.ReactNode;
  timeOffSlot?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [tab, setTab] = useState<Tab>(initialTab ?? "schedule");

  return (
    <div>
      <div className="flex items-center gap-1 border-b border-steel/20 mb-6">
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
        <div>
          {settingsSlot}
          <AvailabilityManagerDesktop
            coachId={coachId}
            initialWindows={initialWindows.map((w) => ({ ...w, sessionMinutes: w.sessionMinutes ?? null, sessionTypeId: w.sessionTypeId ?? null }))}
            sessionLengthEnabled={sessionLengthEnabled}
            initialBufferMinutes={initialBufferMinutes}
            sessionTypes={sessionTypes}
            sessionTypeEnabled={sessionTypeEnabled}
          />
          {timeOffSlot}
        </div>
      )}
    </div>
  );
}
