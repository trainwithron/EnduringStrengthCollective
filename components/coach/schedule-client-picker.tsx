"use client";

import { useRouter } from "next/navigation";

export interface ScheduleClientOption {
  id: string;
  fullName: string;
  balance: number;
  // The client's own group (a one-on-one client lives in their own). Booking and balances are kept per group.
  groupId?: string;
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
            {c.fullName} — {c.balance < 0 ? `owed ${Math.abs(c.balance)}` : `${c.balance} ${c.balance === 1 ? "session" : "sessions"}`}
          </option>
        ))}
      </select>
    </div>
  );
}
