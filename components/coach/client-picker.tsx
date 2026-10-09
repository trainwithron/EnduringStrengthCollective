"use client";

import { useRouter, usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { useTerm } from "@/components/coach/terminology-provider";

export function ClientPicker({
  athletes,
  selectedAthleteId,
}: {
  athletes: { id: string; fullName: string }[];
  selectedAthleteId: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const term = useTerm();

  return (
    <label className="block max-w-sm">
      <span className="font-body text-xs text-steel uppercase tracking-wide">{term("client", "singular", { cap: true })}</span>
      <div className="relative mt-1">
    <select
      value={selectedAthleteId ?? ""}
      onChange={(e) => {
        const value = e.target.value;
        router.push(value ? `${pathname}?athlete=${value}` : pathname);
      }}
      className="w-full h-11 appearance-none bg-surface border border-steel/30 text-chalk pl-3 pr-9 font-body text-sm focus:outline-none focus:border-rust"
    >
      <option value="">Select a {term("client")}…</option>
      {athletes.map((a) => (
        <option key={a.id} value={a.id}>
          {a.fullName}
        </option>
      ))}
    </select>
        <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-3.5 w-4 h-4 text-steel" />
      </div>
    </label>
  );
}
