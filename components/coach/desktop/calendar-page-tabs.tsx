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
  }[];
  // The same three numbers as the Availability page: how often a start is offered, how long a session lasts, and the gap between sessions.
  sessionLengthEnabled?: boolean;
  initialBufferMinutes?: number;
  // Lets a deep link (e.g. the Scheduling Spot's "Edit" action) land
  // straight on Availability instead of always defaulting to Schedule.
  initialTab?: Tab;
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
        <AvailabilityManagerDesktop
          coachId={coachId}
          initialWindows={initialWindows.map((w) => ({ ...w, sessionMinutes: w.sessionMinutes ?? null }))}
          sessionLengthEnabled={sessionLengthEnabled}
          initialBufferMinutes={initialBufferMinutes}
        />
      )}
    </div>
  );
}
