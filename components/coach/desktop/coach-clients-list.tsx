"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { filterClients, filterCounts, FILTER_LABELS, clientKind, type ClientFilter, type CoachClientRow } from "@/lib/coach-client-filter";

const FILTERS: ClientFilter[] = ["all", "one_on_one", "online", "group", "set_aside"];
const KIND_LABEL = { one_on_one: "1-on-1", online: "Online", group: "Group" } as const;

// The coach-level Clients list: every client once, wherever the coach is standing. Filters for how they work with the coach, a name search, and one quiet number
// per client (sessions still to schedule). Tapping a client opens their space.
export function CoachClientsList({ rows }: { rows: CoachClientRow[] }) {
  const [filter, setFilter] = useState<ClientFilter>("all");
  const [query, setQuery] = useState("");
  const counts = useMemo(() => filterCounts(rows), [rows]);
  const shown = useMemo(() => filterClients(rows, filter, query), [rows, filter, query]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={`h-9 px-3 font-body text-[13px] border ${filter === f ? "bg-rust text-graphite border-rust" : "border-steel/40 text-chalk hover:border-rust"}`}
          >
            {FILTER_LABELS[f]} <span className={filter === f ? "text-graphite/80" : "text-steel"}>{counts[f]}</span>
          </button>
        ))}
        <label className="relative ml-auto block w-full sm:w-64">
          <span className="sr-only">Search clients</span>
          <Search className="w-3.5 h-3.5 text-steel absolute left-2.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name"
            className="w-full h-9 bg-graphite border border-steel/30 text-chalk pl-8 pr-2 font-body text-sm focus:outline-none focus:border-rust"
          />
        </label>
      </div>

      {shown.length === 0 ? (
        <p className="font-body text-sm text-steel py-6">{rows.length === 0 ? "No clients yet." : "No one matches."}</p>
      ) : (
        <ul className="divide-y divide-steel/15 border-y border-steel/15">
          {shown.map((c) => (
            <li key={`${c.id}:${c.groupId}`}>
              <Link href={`/groups/${c.groupId}/athletes/${c.id}`} className="flex items-center gap-3 py-2.5 px-1 hover:bg-surface/60">
                <span className="font-body text-sm text-chalk flex-1 min-w-0 truncate">{c.fullName}</span>
                <span className="font-body text-xs text-steel shrink-0 hidden sm:inline">{KIND_LABEL[clientKind(c)]}</span>
                {c.groupKind !== "one_on_one" && <span className="font-body text-xs text-steel shrink-0 hidden md:inline truncate max-w-[10rem]">{c.groupName}</span>}
                <span className="flex items-center justify-end gap-2 shrink-0 w-24 pr-2">
                  {c.owed > 0 && (
                    <span title="Already delivered beyond what they had" className="font-body text-[11px] text-rust">
                      owed {c.owed}
                    </span>
                  )}
                  <span title={`${c.toBook} left to schedule`} aria-label={`${c.toBook} left to schedule`} className={`font-body text-sm tabular-nums w-7 text-right ${c.toBook > 0 ? "text-chalk" : "text-steel/40"}`}>
                    {c.toBook}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="font-body text-[11px] text-steel/70 mt-2">The number is how many sessions are left to schedule.</p>
    </div>
  );
}
