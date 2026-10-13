"use client";

import { CoachSpotHub } from "@/components/coach/mobile/coach-spot-hub";

// The frame a coach sees while logging a workout FOR a client on the phone: ONE slim line ("Coach mode" on the left, "Logging for [Name]" on the right) so the workout gets the height. The Spotlight button
// sits in the middle of it, and the way back to the coach's Home is inside that button (its first entry), so the bar needs no Home button.
export function CoachModeBar({ groupId, clientName, homeHref }: { groupId: string; clientName: string; homeHref: string }) {
  return (
    <>
      <div data-testid="coach-mode-bar" className="sticky top-0 z-30 h-8 bg-rust text-graphite flex items-center justify-between gap-2 px-3 box-content pt-[env(safe-area-inset-top)]">
        <span className="font-body text-xs font-semibold uppercase tracking-wide w-[calc(50%-24px)] truncate">Coach mode</span>
        <span className="font-body text-xs w-[calc(50%-24px)] truncate text-right">Logging for {clientName}</span>
      </div>
      <CoachSpotHub groupId={groupId} homeHref={homeHref} compact />
    </>
  );
}
