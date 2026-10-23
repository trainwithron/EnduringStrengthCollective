"use client";

import Link from "next/link";
import { useState } from "react";
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
export function SpotNeedsTop({ needs, onNavigated, onNoticesCleared }: { needs: SpotNeeds; onNavigated: () => void; onNoticesCleared?: () => void }) {
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState(false);
  const now = new Date();
  const showNext = needs.next && needs.next.athleteId !== needs.open?.athleteId;
  const nextHref = needs.next ? (needs.next.hasProgram ? `/groups/${needs.next.groupId}/athletes/${needs.next.athleteId}/log` : `/groups/${needs.next.groupId}/athletes/${needs.next.athleteId}`) : null;

  function openNotice(id: string) {
    // Marked read the way the bell does it; the link opens either way.
    void createBrowserClient().from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
    onNavigated();
  }

  // Ron, Oct 23: "there's not a way to clear notifications from the spot". The same as the bell's Mark all read: these notices are marked read and the list goes.
  async function markAllRead() {
    if (clearing) return;
    setClearing(true);
    setClearError(false);
    const { error } = await createBrowserClient().from("notifications").update({ read_at: new Date().toISOString() }).in("id", needs.notices.map((n) => n.id));
    setClearing(false);
    if (error) {
      setClearError(true);
      return;
    }
    onNoticesCleared?.();
  }

  return (
    <div className="col-span-2 space-y-3" data-spot-needs>
      {needs.notices.length > 0 && (
        <div className="flex items-center justify-between gap-3">
          <p className="font-body text-xs text-steel uppercase tracking-wide">Notifications</p>
          <button type="button" onClick={markAllRead} disabled={clearing} className="min-h-11 px-2 -my-2 font-body text-xs text-rust underline underline-offset-2 disabled:opacity-50" data-spot-mark-all>
            {clearing ? "Marking…" : "Mark all read"}
          </button>
        </div>
      )}
      {clearError && (
        <p className="font-body text-xs text-rust" role="alert">
          Couldn&apos;t mark them read. Try again.
        </p>
      )}
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
          {/* Notice links (#late-changes, #schedule-requests, #expiring) open Spotlight on the panel they name (coach-spot-hub.tsx). */}
          <div data-spot-anchor="late-changes">
            <LateChangesPanel groupIds={needs.groupIds} />
          </div>
          <div data-spot-anchor="schedule-requests">
            <ScheduleRequestsPanel groupIds={needs.groupIds} />
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
