"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { CalendarClientList, type CalendarClientRow } from "./calendar-client-list";
import { useCalendarScheduling } from "./calendar-scheduling-context";
import { inactiveKey } from "@/lib/inactive-ids";
import { ClientSchedulePanel } from "./client-schedule-panel";

// The calendar's client list, at the top of the rail where the coach drags from (Ron, Oct 6): searchable, collapsible, scrolling on its own, with clients the
// coach has set aside left out until asked for. Drag a name onto a day, or tap a name, then a day, then a time.
export function CalendarClientRail({
  clients,
  setAsideKeys,
  selectedClientId,
  timezone,
  sessionTypes,
}: {
  clients: CalendarClientRow[];
  // `${groupId}:${profileId}` for each client the coach has set aside.
  setAsideKeys: string[];
  selectedClientId?: string;
  timezone: string;
  sessionTypes: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [showSetAside, setShowSetAside] = useState(false);
  const { client: picked } = useCalendarScheduling();

  const aside = useMemo(() => new Set(setAsideKeys), [setAsideKeys]);
  const isAside = (c: CalendarClientRow) => aside.has(inactiveKey(c.groupId, c.profileId));
  const asideCount = clients.filter(isAside).length;
  const q = query.trim().toLowerCase();
  const rows = clients.filter((c) => (showSetAside || !isAside(c) || picked?.athleteId === c.profileId) && (q === "" || c.fullName.toLowerCase().includes(q)));

  return (
    <section aria-label="Clients" className="mb-6">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between min-h-[32px] font-display uppercase text-sm tracking-wide text-steel"
      >
        <span>
          Clients <span className="font-body normal-case text-xs">({clients.length - asideCount})</span>
        </span>
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>
      {open && (
        <>
          <p className="font-body text-xs text-steel mt-1">
            {picked ? `${picked.fullName} is picked: tap a day, then a time.` : "Drag a name onto a day, or tap a name, then a day."}
          </p>
          <p className="font-body text-[11px] text-steel/70 mb-2">The number is how many sessions are left to schedule.</p>
          <label className="relative block mb-2">
            <span className="sr-only">Search clients</span>
            <Search className="w-3.5 h-3.5 text-steel absolute left-2 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search clients"
              className="w-full h-9 bg-graphite border border-steel/30 text-chalk pl-7 pr-2 font-body text-sm focus:outline-none focus:border-rust"
            />
          </label>
          <div className="max-h-[52vh] overflow-y-auto scroll-hidden">
            <CalendarClientList clients={rows} selectedClientId={selectedClientId} />
          </div>
          {picked && <ClientSchedulePanel key={picked.athleteId} client={picked} timezone={timezone} sessionTypes={sessionTypes} />}
          {asideCount > 0 && (
            <button type="button" onClick={() => setShowSetAside((s) => !s)} className="mt-2 font-body text-xs text-steel underline underline-offset-2">
              {showSetAside ? "Hide set-aside" : `Show set-aside (${asideCount})`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
