"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { LayoutGrid, List, Search } from "lucide-react";
import { DEFAULT_CLIENTS_VIEW, readClientsView, writeClientsView, type ClientsView } from "@/lib/clients-view-pref";
import { filterClients, filterCounts, FILTER_LABELS, clientKind, type ClientFilter, type CoachClientRow } from "@/lib/coach-client-filter";

const FILTERS: ClientFilter[] = ["all", "one_on_one", "online", "group", "set_aside"];
const KIND_LABEL = { one_on_one: "1-on-1", online: "Online", group: "Group" } as const;

// The coach-level Clients list: every client once, wherever the coach is standing. Filters for how they work with the coach, a name search, and one quiet number
// per client (sessions still to schedule). Tapping a client opens their space.
export function CoachClientsList({ rows }: { rows: CoachClientRow[] }) {
  const [filter, setFilter] = useState<ClientFilter>("all");
  const [query, setQuery] = useState("");
  // Cards by default; the coach's last choice is read once the page is on screen (never during the server render, so the two always agree first).
  const [view, setView] = useState<ClientsView>(DEFAULT_CLIENTS_VIEW);
  useEffect(() => {
    setView(readClientsView(typeof window === "undefined" ? null : window.localStorage));
  }, []);
  function chooseView(next: ClientsView) {
    setView(next);
    writeClientsView(typeof window === "undefined" ? null : window.localStorage, next);
  }
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
        <div role="group" aria-label="View" className="ml-auto flex border border-steel/40 shrink-0">
          {(["cards", "list"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => chooseView(v)}
              className={`h-11 sm:h-9 px-3 font-body text-[13px] flex items-center gap-1.5 ${view === v ? "bg-rust text-graphite" : "text-chalk hover:text-rust"}`}
            >
              {v === "cards" ? <LayoutGrid className="w-3.5 h-3.5" aria-hidden="true" /> : <List className="w-3.5 h-3.5" aria-hidden="true" />}
              {v === "cards" ? "Cards" : "List"}
            </button>
          ))}
        </div>
        <label className="relative block w-full sm:w-64">
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
        view === "cards" ? <ClientsCardView rows={shown} /> : <ClientsListView rows={shown} />
      )}
      <p className="font-body text-[11px] text-steel/70 mt-2">The number is how many sessions are left to schedule.</p>
    </div>
  );
}

// The plain list: one row per client.
export function ClientsListView({ rows }: { rows: CoachClientRow[] }) {
  return (
          <ul className="divide-y divide-steel/15 border-y border-steel/15">
            {rows.map((c) => (
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
  );
}

const initialsOf = (name: string): string =>
  name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

// The same clients as cards: initials, name, how they work with the coach, their space, and the one quiet number (sessions left to schedule). The whole card opens the client.
export function ClientsCardView({ rows }: { rows: CoachClientRow[] }) {
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3" aria-label="Clients">
      {rows.map((c) => (
        <li key={`${c.id}:${c.groupId}`}>
          <Link
            href={`/groups/${c.groupId}/athletes/${c.id}`}
            className="block min-h-11 h-full border border-steel/25 bg-surface/40 hover:border-rust p-3 active:bg-surface/70"
          >
            <span className="flex items-start gap-3">
              <span className="w-10 h-10 rounded-full bg-graphite border border-steel/30 flex items-center justify-center shrink-0 font-display text-xs" aria-hidden="true">
                {initialsOf(c.fullName)}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block font-body text-sm font-medium text-chalk break-words">{c.fullName}</span>
                <span className="block font-body text-xs text-steel mt-0.5">
                  {KIND_LABEL[clientKind(c)]}
                  {c.setAside ? " · set aside" : ""}
                </span>
                {c.groupKind !== "one_on_one" && c.groupName && <span className="block font-body text-xs text-steel/80 truncate">{c.groupName}</span>}
              </span>
              <span className="flex flex-col items-end shrink-0">
                <span title={`${c.toBook} left to schedule`} aria-label={`${c.toBook} left to schedule`} className={`font-display text-xl tabular-nums leading-none ${c.toBook > 0 ? "text-chalk" : "text-steel/40"}`}>
                  {c.toBook}
                </span>
                <span className="font-body text-[10px] text-steel mt-1">to schedule</span>
                {c.owed > 0 && (
                  <span title="Already delivered beyond what they had" className="font-body text-[11px] text-rust mt-0.5">
                    owed {c.owed}
                  </span>
                )}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
