"use client";

import { useRouter } from "next/navigation";
import { buildCreditPicture } from "@/lib/credit-picture";
import { isOnlineClient, offeredForBooking } from "@/lib/client-type";
import type { ClientTierLite } from "@/lib/session-type-default";
import { useShowOnlineClients } from "@/components/coach/use-show-online-clients";

export interface ScheduleClientOption {
  id: string;
  fullName: string;
  balance: number;
  // Sessions scheduled with the coach that have not happened yet: the number shown is what is still available to schedule.
  booked?: number;
  // The client's own group (a one-on-one client lives in their own). Booking and balances are kept per group.
  groupId?: string;
  // The client's type (tier) and whether the coach set them aside: Online and set-aside clients are left out of the list until asked for (lib/client-type.ts).
  tier?: ClientTierLite;
  setAside?: boolean;
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
  const [showOnline, setShowOnline] = useShowOnlineClients();
  const onlineCount = clients.filter((c) => !c.setAside && isOnlineClient(c.tier)).length;
  const offered = offeredForBooking(clients, { tierOf: (c) => c.tier, isSetAside: (c) => !!c.setAside, showOnline, keep: (c) => c.id === selectedId });

  return (
    <div className="px-5 pt-4 pb-2 border-b border-steel/20">
      <label className="font-body text-xs text-steel uppercase tracking-wide">
        Calendar for
      </label>
      <select aria-label="Calendar for"
        value={selectedId ?? ""}
        onChange={(e) => {
          const value = e.target.value;
          const target = clients.find((c) => c.id === value);
          router.push(value ? `/groups/${target?.groupId ?? groupId}/calendar?scheduleFor=${value}` : `/groups/${groupId}/calendar`);
        }}
        className="w-full h-11 mt-1 bg-graphite border border-steel/30 text-chalk px-2 font-body text-base sm:text-sm focus:outline-none focus:border-rust"
      >
        <option value="">All clients</option>
        {offered.map((c) => (
          <option key={c.id} value={c.id}>
            {c.fullName} — {pickerNumber(c.balance, c.booked ?? 0)}
          </option>
        ))}
      </select>
      {onlineCount > 0 && (
        <label className="mt-2 flex items-center gap-2 min-h-11 font-body text-sm text-steel">
          <input type="checkbox" checked={showOnline} onChange={(e) => setShowOnline(e.target.checked)} className="w-4 h-4 accent-rust" />
          Show online clients ({onlineCount})
        </label>
      )}
    </div>
  );
}
