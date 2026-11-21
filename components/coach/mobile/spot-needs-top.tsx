"use client";

import Link from "next/link";
import { SessionCheckCards } from "@/components/coach/session-check-cards";
import { LateChangesPanel } from "@/components/coach/late-changes-panel";
import { ScheduleRequestsPanel } from "@/components/coach/schedule-requests-panel";
import { ExpiryCheckInPanel } from "@/components/coach/expiry-checkin-panel";
import { InactiveClientsPanel } from "@/components/coach/inactive-clients-panel";
import { ProgressLookPanel } from "@/components/coach/progress-look-panel";
import { nextSessionLabel } from "@/lib/next-session-order";
import type { SpotNeeds } from "@/lib/spot-needs";
import { REQUESTS_PATH } from "@/lib/requests-center";
import { COACH_CHECKINS_PATH } from "@/lib/weekly-checkin";

// The top of the Spotlight drop-down on a coach's phone: what needs the coach first. Requests (n) and Check-ins (n) when something waits there, "did this session happen?", the next client's workout (or one left open),
// then the same panels Home shows (late changes, schedule requests, expiring sessions, quiet clients, progress looks). Each part draws nothing when it has nothing.
// Notices are not listed here (Nov 21, PH14): they live only in the bell beside Spotlight, with its own unread count and Mark all read.
export function SpotNeedsTop({ needs, onNavigated, onChanged }: { needs: SpotNeeds; onNavigated: () => void; onChanged?: () => void }) {
  const now = new Date();
  const showNext = needs.next && needs.next.athleteId !== needs.open?.athleteId;
  // Audit P11 (Nov 21): the client's log page, which offers today's workout and Wing it (it used to open their profile when they had no program). PH24: when that page would offer
  // exactly one Start, the workout itself (one Start tap, not two).
  const nextHref = needs.next ? needs.next.startHref || `/groups/${needs.next.groupId}/athletes/${needs.next.athleteId}/log` : null;

  return (
    <div className="col-span-2 space-y-3" data-spot-needs>
      {/* First, the two pages that hold what waits (PH3): only when something is waiting there. */}
      {(needs.requestsWaiting > 0 || needs.checkinsToReview > 0) && (
        <ul className="border border-steel/20 divide-y divide-steel/15" aria-label="Waiting pages" data-spot-waiting-pages>
          {needs.requestsWaiting > 0 && (
            <li>
              <Link href={REQUESTS_PATH} onClick={onNavigated} className="flex items-center justify-between gap-3 px-3 min-h-11 font-body text-sm text-chalk" data-spot-requests>
                <span>Requests ({needs.requestsWaiting})</span>
                <span aria-hidden="true" className="text-rust-ink">→</span>
              </Link>
            </li>
          )}
          {needs.checkinsToReview > 0 && (
            <li>
              <Link href={COACH_CHECKINS_PATH} onClick={onNavigated} className="flex items-center justify-between gap-3 px-3 min-h-11 font-body text-sm text-chalk" data-spot-checkins>
                <span>Check-ins ({needs.checkinsToReview})</span>
                <span aria-hidden="true" className="text-rust-ink">→</span>
              </Link>
            </li>
          )}
        </ul>
      )}
      {/* An answer re-reads what is waiting, so the count on the button follows (audit P31). */}
      {needs.sessionsToCheck.length > 0 && <SessionCheckCards sessions={needs.sessionsToCheck} timezone={needs.timezone} onAnswered={onChanged} />}
      {needs.open && (
        <Link href={`/sessions/${needs.open.sessionId}?resume=1`} onClick={onNavigated} className="block w-full min-h-14 px-4 py-2.5 bg-rust text-graphite text-center">
          <span className="block font-display uppercase text-base font-bold leading-tight">Resume {needs.open.name}&apos;s workout</span>
          <span className="block font-body text-xs">Started {nextSessionLabel(needs.open.startedIso, needs.timezone, now)}</span>
        </Link>
      )}
      {showNext && needs.next && nextHref && (
        <Link href={nextHref} onClick={onNavigated} className="block w-full min-h-14 px-4 py-2.5 bg-rust text-graphite text-center">
          <span className="block font-display uppercase text-base font-bold leading-tight">Start {needs.next.name}&apos;s workout</span>
          <span className="block font-body text-xs">{nextSessionLabel(needs.next.startIso, needs.timezone, now)}</span>
        </Link>
      )}
      {needs.groupIds.length > 0 && (
        <>
          {/* Notice links (#late-changes, #schedule-requests, #expiring) open Spotlight on the panel they name (coach-spot-hub.tsx). */}
          <div data-spot-anchor="late-changes">
            <LateChangesPanel groupIds={needs.groupIds} onChanged={onChanged} />
          </div>
          <div data-spot-anchor="schedule-requests">
            <ScheduleRequestsPanel groupIds={needs.groupIds} onChanged={onChanged} />
          </div>
          <div data-spot-anchor="expiring">
            <ExpiryCheckInPanel groupIds={needs.groupIds} />
          </div>
          <InactiveClientsPanel groupIds={needs.groupIds} />
          <ProgressLookPanel groupIds={needs.groupIds} />
        </>
      )}
    </div>
  );
}
