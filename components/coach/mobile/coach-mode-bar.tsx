"use client";

import Link from "next/link";
import { CoachSpotHub } from "@/components/coach/mobile/coach-spot-hub";

// The frame a coach sees while logging a workout FOR a client on the phone. It says plainly whose app this is (the coach's, logging for the client, not the client signed in),
// keeps the coach's Spotlight hub button (Clients, Business, Calendar...) within reach, and gives one tap back to the coach's home. The hub button sits top-centre, so the label
// is on the left and the Home button on the right.
export function CoachModeBar({ groupId, clientName, homeHref }: { groupId: string; clientName: string; homeHref: string }) {
  return (
    <>
      <div data-testid="coach-mode-bar" className="sticky top-0 z-30 h-14 bg-rust text-graphite flex items-center justify-between gap-2 px-3 pt-[env(safe-area-inset-top)]">
        <p className="font-body text-xs font-semibold uppercase tracking-wide leading-tight min-w-0 w-[calc(50%-32px)]">
          <span className="block">Coach mode</span>
          <span className="block font-normal normal-case truncate">Logging for {clientName}</span>
        </p>
        <Link
          href={homeHref}
          className="shrink-0 min-h-11 inline-flex items-center px-3 border border-graphite/60 font-body text-xs font-semibold uppercase tracking-wide active:bg-graphite/10"
        >
          Home
        </Link>
      </div>
      <CoachSpotHub groupId={groupId} />
    </>
  );
}
