"use client";

import { useRouter } from "next/navigation";

export interface ScheduleClientOption {
  id: string;
  fullName: string;
  balance: number;
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
      <label className="font-body text-[11px] text-steel uppercase tracking-wide">
        Schedule a client
      </label>
      <select
        value={selectedId ?? ""}
        onChange={(e) => {
          const value = e.target.value;
          router.push(value ? `/groups/${groupId}/calendar?scheduleFor=${value}` : `/groups/${groupId}/calendar`);
        }}
        className="w-full h-10 mt-1 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust"
      >
        <option value="">Select a client…</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.fullName} — {c.balance} {c.balance === 1 ? "credit" : "credits"}
          </option>
        ))}
      </select>
    </div>
  );
}
