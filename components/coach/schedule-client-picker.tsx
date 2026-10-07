"use client";

import { useRouter } from "next/navigation";
import { buildCreditPicture } from "@/lib/credit-picture";

export interface ScheduleClientOption {
  id: string;
  fullName: string;
  balance: number;
  // Sessions scheduled with the coach that have not happened yet: the number shown is what is still available to schedule.
  booked?: number;
  // The client's own group (a one-on-one client lives in their own). Booking and balances are kept per group.
  groupId?: string;
}

// ONE quiet number: how many are still available to schedule, or "owed N" when more are booked than they have.
function pickerNumber(balance: number, booked: number): string {
  const picture = buildCreditPicture({ balance, booked, toMark: 0 });
  return picture.owed > 0 ? `owed ${picture.owed}` : String(picture.toBook);
}

export function ScheduleClientPicker({
  groupId,
  clients,
  selectedId,
}: {
  groupId: string;
  clients: ScheduleClientOption[];
  selectedId?: string;
}) {
  const router = useRouter();

  return (
    <div className="px-5 pt-4 pb-2 border-b border-steel/20">
      <label className="font-body text-xs text-steel uppercase tracking-wide">
        Calendar for
      </label>
      <select
        value={selectedId ?? ""}
        onChange={(e) => {
          const value = e.target.value;
          const target = clients.find((c) => c.id === value);
          router.push(value ? `/groups/${target?.groupId ?? groupId}/calendar?scheduleFor=${value}` : `/groups/${groupId}/calendar`);
        }}
        className="w-full h-11 mt-1 bg-graphite border border-steel/30 text-chalk px-2 font-body text-base sm:text-sm focus:outline-none focus:border-rust"
      >
        <option value="">All clients</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.fullName} — {pickerNumber(c.balance, c.booked ?? 0)}
          </option>
        ))}
      </select>
    </div>
  );
}
