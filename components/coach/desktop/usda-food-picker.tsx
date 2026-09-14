"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { Search, X } from "lucide-react";

export interface UsdaFoodOption {
  fdcId: number;
  description: string;
}

// Shared search-and-pick control for mapping a coach's own ingredient
// vocabulary to a real cached USDA food (usda_foods) — used both for
// Recipe Hub v2 custom-recipe ingredients and the built-in recipes'
// shared ingredient keys. Search runs against our own cached table, not
// a live USDA call — no rate limit, no network dependency at read time.
export function UsdaFoodPicker({
  currentFdcId,
  currentDescription,
  onPicked,
}: {
  currentFdcId: number | null;
  currentDescription: string | null;
  onPicked: (fdcId: number | null, description: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UsdaFoodOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);

  async function handleSearch(q: string) {
    setQuery(q);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const supabase = createBrowserClient();
    const { data } = await supabase
      .from("usda_foods")
      .select("fdc_id, description")
      .ilike("description", `%${q.trim()}%`)
      .limit(8);
    setResults((data ?? []).map((r) => ({ fdcId: r.fdc_id, description: r.description })));
    setSearching(false);
  }

  if (currentFdcId && !open) {
    return (
      <div className="flex items-center gap-2">
        <span className="font-body text-[11px] text-moss truncate">{currentDescription ?? `#${currentFdcId}`}</span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="font-body text-[11px] text-steel underline shrink-0"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-1.5 border border-steel/30 h-8 px-2">
        <Search className="w-3 h-3 text-steel shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search real USDA foods…"
          className="flex-1 min-w-0 bg-transparent text-chalk font-body text-xs focus:outline-none"
        />
        {currentFdcId && (
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setQuery("");
              setResults([]);
            }}
            aria-label="Cancel"
            className="text-steel shrink-0"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      {(searching || results.length > 0) && (
        <div className="absolute z-10 left-0 right-0 mt-1 bg-graphite border border-steel/30 max-h-48 overflow-y-auto">
          {searching && <p className="font-body text-[11px] text-steel p-2">Searching…</p>}
          {!searching &&
            results.map((r) => (
              <button
                key={r.fdcId}
                type="button"
                onClick={() => {
                  onPicked(r.fdcId, r.description);
                  setOpen(false);
                  setQuery("");
                  setResults([]);
                }}
                className="block w-full text-left px-2 py-1.5 font-body text-xs text-chalk hover:bg-rust/10"
              >
                {r.description}
              </button>
            ))}
          {!searching && results.length === 0 && query.trim().length >= 2 && (
            <p className="font-body text-[11px] text-steel p-2">
              No cached USDA foods match yet — the reference set is still growing.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
