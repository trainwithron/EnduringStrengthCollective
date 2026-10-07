"use client";

import { DraggableClientName } from "./draggable-client-name";
import { useCalendarScheduling } from "./calendar-scheduling-context";
import { buildCreditPicture } from "@/lib/credit-picture";

export interface CalendarClientRow {
  profileId: string;
  fullName: string;
  balance: number;
  // The client's own group (a one-on-one client lives in their own).
  groupId: string;
  // Sessions the coach scheduled that have not happened yet, and past ones waiting to be marked (see lib/credit-picture.ts).
  booked?: number;
  toMark?: number;
}

// The main calendar's client list: just names, each with ONE quiet number, how many sessions are still available to schedule (Ron, Oct 6: "nice and easy").
// A small marker shows when more are booked than the client has (coach only). Everything else about a client (the full sentence, session credits, their sessions
// and their calendar) is one tap away in the panel that opens under the list. Drag a name onto a day, or tap it, then a day, then a time.
export function CalendarClientList({ clients, selectedClientId }: { clients: CalendarClientRow[]; selectedClientId?: string }) {
  const { client: picked, setClient } = useCalendarScheduling();

  if (clients.length === 0) {
    return <p className="font-body text-sm text-steel">No one to show.</p>;
  }

  return (
    <div className="divide-y divide-steel/15">
      {clients.map((c) => {
        const isSelected = (picked ? picked.athleteId : selectedClientId) === c.profileId;
        const picture = buildCreditPicture({ balance: c.balance, booked: c.booked ?? 0, toMark: c.toMark ?? 0 });
        return (
          <div key={c.profileId} className="flex items-center justify-between py-1.5 gap-2">
            <DraggableClientName client={{ athleteId: c.profileId, fullName: c.fullName, balance: c.balance, groupId: c.groupId }} className="min-w-0 flex-1">
              <button
                type="button"
                aria-pressed={isSelected}
                onClick={() => setClient(isSelected ? null : { athleteId: c.profileId, fullName: c.fullName, balance: c.balance, groupId: c.groupId })}
                className={`font-body text-sm text-left min-h-[32px] w-full truncate ${isSelected ? "text-rust font-medium" : "text-chalk"}`}
              >
                {c.fullName}
              </button>
            </DraggableClientName>
            <span className="flex items-center gap-2 shrink-0">
              {picture.owed > 0 && (
                <span title={`${picture.owed} more than they have`} className="font-body text-[11px] text-rust">
                  owed {picture.owed}
                </span>
              )}
              <span
                title="Sessions still available to schedule"
                aria-label={`${picture.toBook} to schedule`}
                className={`font-body text-xs w-5 text-right ${picture.toBook > 0 ? "text-steel" : "text-steel/40"}`}
              >
                {picture.toBook}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
