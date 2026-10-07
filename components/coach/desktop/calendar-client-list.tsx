"use client";

import { useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";
import { DraggableClientName } from "./draggable-client-name";
import { useCalendarScheduling } from "./calendar-scheduling-context";
import { coachCreditLine } from "@/lib/pending-credit-copy";

export interface CalendarClientRow {
  profileId: string;
  fullName: string;
  balance: number;
  // The client's own group (a one-on-one client lives in their own).
  groupId: string;
  // Sessions the coach scheduled that have not happened yet: they take a session when they do, so they show beside the balance, not out of it.
  pending?: number;
}

// The main calendar's client roster — same list used for drag-to-schedule,
// now also lets the coach bump a client's session-credit balance right
// here with +/- buttons, instead of opening their full profile just to
// adjust a number.
export function CalendarClientList({
  clients,
  selectedClientId,
}: {
  clients: CalendarClientRow[];
  groupId?: string;
  basePath?: string;
  monthParam?: string;
  selectedClientId?: string;
}) {
  const [balances, setBalances] = useState<Record<string, number>>(
    Object.fromEntries(clients.map((c) => [c.profileId, c.balance]))
  );
  const [adjusting, setAdjusting] = useState<string | null>(null);
  // Tapping a name picks that client for scheduling (tap a client, tap a day, tap a time); tapping again lets go. Dragging a name works as before.
  const { client: picked, setClient } = useCalendarScheduling();

  async function adjust(profileId: string, delta: number, clientGroupId: string) {
    setAdjusting(profileId);
    const supabase = createBrowserClient();
    const { data: newBalance } = await supabase.rpc("adjust_session_credits", {
      p_athlete_id: profileId,
      p_group_id: clientGroupId,
      p_delta: delta,
    });
    if (typeof newBalance === "number") {
      setBalances((prev) => ({ ...prev, [profileId]: newBalance }));
    }
    setAdjusting(null);
  }

  if (clients.length === 0) {
    return <p className="font-body text-sm text-steel">No one to show.</p>;
  }

  return (
    <div className="divide-y divide-steel/15">
      {clients.map((c) => {
        const isSelected = (picked ? picked.athleteId : selectedClientId) === c.profileId;
        const balance = balances[c.profileId] ?? c.balance;
        return (
          <div key={c.profileId} className="flex items-center justify-between py-2.5 gap-2">
            <DraggableClientName client={{ athleteId: c.profileId, fullName: c.fullName, balance, groupId: c.groupId }}>
              <button
                type="button"
                aria-pressed={isSelected}
                onClick={() => setClient(isSelected ? null : { athleteId: c.profileId, fullName: c.fullName, balance, groupId: c.groupId })}
                className={`font-body text-sm text-left min-h-[32px] ${isSelected ? "text-rust font-medium" : "text-chalk"}`}
              >
                {c.fullName}
              </button>
              {(c.pending ?? 0) > 0 && <span className="block font-body text-[11px] text-steel">{coachCreditLine(balance, c.pending ?? 0)}</span>}
            </DraggableClientName>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => adjust(c.profileId, -1, c.groupId)}
                disabled={adjusting === c.profileId || balance === 0}
                aria-label={`Remove a session credit from ${c.fullName}`}
                className="w-5 h-5 flex items-center justify-center border border-steel/30 text-steel font-body text-xs active:border-rust active:text-rust disabled:opacity-30"
              >
                &minus;
              </button>
              <span
                className={`font-body text-xs px-1.5 py-0.5 border w-7 text-center ${
                  balance > 0 ? "border-steel/30 text-chalk" : "border-steel/15 text-steel"
                }`}
              >
                {balance}
              </span>
              <button
                type="button"
                onClick={() => adjust(c.profileId, 1, c.groupId)}
                disabled={adjusting === c.profileId}
                aria-label={`Add a session credit to ${c.fullName}`}
                className="w-5 h-5 flex items-center justify-center border border-steel/30 text-steel font-body text-xs active:border-rust active:text-rust disabled:opacity-30"
              >
                +
              </button>
              <Link
                href={`/groups/${c.groupId}/athletes/${c.profileId}/calendar`}
                className="text-rust text-xs font-body ml-1"
              >
                Open &rarr;
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}
