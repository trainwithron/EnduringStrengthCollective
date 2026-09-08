"use client";

import { useState } from "react";
import { AvailabilityManagerDesktop } from "./availability-manager-desktop";

type Tab = "schedule" | "availability";

export function CalendarPageTabs({
  coachId,
  initialWindows,
  children,
}: {
  coachId: string;
  initialWindows: {
    id: string;
    weekday: number;
    startTime: string;
    endTime: string;
    slotDurationMinutes: number;
  }[];
  children: React.ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("schedule");

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
        <AvailabilityManagerDesktop coachId={coachId} initialWindows={initialWindows} />
      )}
    </div>
  );
}
