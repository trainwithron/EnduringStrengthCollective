"use client";

import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";
import { SessionCheckCards } from "@/components/coach/session-check-cards";
import { LateChangesPanel } from "@/components/coach/late-changes-panel";
import { ScheduleRequestsPanel } from "@/components/coach/schedule-requests-panel";
import { ExpiryCheckInPanel } from "@/components/coach/expiry-checkin-panel";
import { InactiveClientsPanel } from "@/components/coach/inactive-clients-panel";
import { ProgressLookPanel } from "@/components/coach/progress-look-panel";
import { nextSessionLabel } from "@/lib/next-session-order";
import type { SpotNeeds } from "@/lib/spot-needs";

// The top of the Spotlight drop-down on a coach's phone: what needs the coach first. Unread notices (the bell's), "did this session happen?", the next client's workout (or one left open),
// then the same panels Home shows (late changes, schedule requests, expiring sessions, quiet clients, progress looks). Each part draws nothing when it has nothing.
export function SpotNeedsTop({ needs, onNavigated }: { needs: SpotNeeds; onNavigated: () => void }) {
  const now = new Date();
  const showNext = needs.next && needs.next.athleteId !== needs.open?.athleteId;
  const nextHref = needs.next ? (needs.next.hasProgram ? `/groups/${needs.next.groupId}/athletes/${needs.next.athleteId}/log` : `/groups/${needs.next.groupId}/athletes/${needs.next.athleteId}`) : null;

  function openNotice(id: string) {
    // Marked read the way the bell does it; the link opens either way.
    void createBrowserClient().from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
    onNavigated();
  }

  return (
    <div className="col-span-2 space-y-3" data-spot-needs>
      {needs.notices.length > 0 && (
        <ul className="border border-steel/20 divide-y divide-steel/15" aria-label="Notifications">
          {needs.notices.map((n) => (
            <li key={n.id}>
              <Link href={n.linkPath} onClick={() => openNotice(n.id)} className="block px-3 py-2.5 font-body text-sm text-chalk min-h-11">
                {n.body}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {needs.sessionsToCheck.length > 0 && <SessionCheckCards sessions={needs.sessionsToCheck} timezone={needs.timezone} />}
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
          <LateChangesPanel groupIds={needs.groupIds} />
          <ScheduleRequestsPanel groupIds={needs.groupIds} />
          <ExpiryCheckInPanel groupIds={needs.groupIds} />
          <InactiveClientsPanel groupIds={needs.groupIds} />
          <ProgressLookPanel groupIds={needs.groupIds} />
        </>
      )}
    </div>
  );
}
