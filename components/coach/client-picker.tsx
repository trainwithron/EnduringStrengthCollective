"use client";

import { useRouter, usePathname } from "next/navigation";

export function ClientPicker({
  athletes,
  selectedAthleteId,
}: {
  athletes: { id: string; fullName: string }[];
  selectedAthleteId: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <select
      value={selectedAthleteId ?? ""}
      onChange={(e) => {
        const value = e.target.value;
        router.push(value ? `${pathname}?athlete=${value}` : pathname);
      }}
      className="w-full h-11 bg-surface border border-steel/30 text-chalk px-3 font-body focus:outline-none focus:border-rust"
    >
      <option value="">Select a client…</option>
      {athletes.map((a) => (
        <option key={a.id} value={a.id}>
          {a.fullName}
        </option>
      ))}
    </select>
  );
}
