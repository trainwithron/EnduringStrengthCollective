"use client";

import { useState } from "react";

export interface PickItem {
  key: string;
  label: string;
  // A quiet second line (which group, whose copy, ...).
  sub?: string | null;
  disabled?: boolean;
}

// The one list a coach picks from by tapping: a search box (only once the list is long), then rows at least 44px tall. Used for picking a client to give a program to and for picking
// a program to give a client, so both behave the same. Picking is one tap; any confirmation is the caller's choice (adding something gets none).
export function SearchPickList({
  items,
  onPick,
  busyKey,
  loading,
  emptyText,
  searchFrom = 8,
  searchLabel = "Search",
}: {
  items: PickItem[] | null;
  onPick: (key: string) => void;
  busyKey?: string | null;
  loading?: boolean;
  emptyText: string;
  searchFrom?: number;
  searchLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = (items ?? []).filter((i) => !q || i.label.toLowerCase().includes(q) || (i.sub ?? "").toLowerCase().includes(q));
  return (
    <div>
      {items && items.length >= searchFrom && (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchLabel}
          aria-label={searchLabel}
          className="block w-full h-11 sm:h-9 mb-2 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust"
        />
      )}
      <div className="max-h-72 overflow-y-auto divide-y divide-steel/15 border border-steel/15">
        {(loading || items === null) && <p className="font-body text-xs text-steel px-3 py-2.5">Loading…</p>}
        {items && !loading && shown.length === 0 && <p className="font-body text-xs text-steel px-3 py-2.5">{items.length === 0 ? emptyText : "Nothing matches that."}</p>}
        {items &&
          shown.map((i) => (
            <button
              key={i.key}
              type="button"
              disabled={busyKey != null || i.disabled}
              onClick={() => onPick(i.key)}
              className="w-full text-left px-3 py-2.5 min-h-11 hover:bg-graphite/50 disabled:opacity-50"
            >
              <span className="block font-body text-sm text-chalk truncate">{busyKey === i.key ? "Assigning…" : i.label}</span>
              {i.sub && <span className="block font-body text-xs text-steel truncate">{i.sub}</span>}
            </button>
          ))}
      </div>
    </div>
  );
}
