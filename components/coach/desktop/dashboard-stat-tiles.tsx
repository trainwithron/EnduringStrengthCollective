"use client";

import { useState } from "react";
import type { StatTileDef } from "@/lib/dashboard-data";
import { SwappableTerm } from "@/components/coach/swappable-term";

// Hover-peek stat tiles (coach_dashboard_redesign_scoping.md) — hovering
// a tile shows every related value at once (zero commitment, a pure
// glance); clicking one both confirms the peek and sets it as that
// tile's new persistent default. Adapted for this coach-desktop, mouse-
// driven surface as hover-to-reveal rather than the touch long-press
// version.
export function DashboardStatTiles({
  tiles,
  initialOverrides,
}: {
  tiles: StatTileDef[];
  initialOverrides: Record<string, string>;
}) {
  const [localTiles, setLocalTiles] = useState(tiles);
  const [overrides, setOverrides] = useState(initialOverrides);
  const [peekTile, setPeekTile] = useState<string | null>(null);

  function pick(tileKey: string, valueKey: string) {
    setLocalTiles((prev) =>
      prev.map((t) => {
        if (t.key !== tileKey) return t;
        const index = t.values.findIndex((v) => v.key === valueKey);
        if (index <= 0) return t;
        const reordered = [...t.values];
        const [chosen] = reordered.splice(index, 1);
        reordered.unshift(chosen);
        return { ...t, values: reordered };
      })
    );
    const nextOverrides = { ...overrides, [tileKey]: valueKey };
    setOverrides(nextOverrides);
    setPeekTile(null);
    fetch("/api/coach/dashboard-layout", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileMetricOverrides: nextOverrides }),
    }).catch(() => {});
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
      {localTiles.map((tile) => {
        const current = tile.values[0];
        const alternates = tile.values.slice(1);
        return (
          <div key={tile.key} className="relative border border-steel/20 bg-surface p-4 text-center">
            <p className="font-display font-bold text-2xl leading-none text-chalk">{current.display}</p>
            <p
              onMouseEnter={() => alternates.length > 0 && setPeekTile(tile.key)}
              onMouseLeave={() => setPeekTile((v) => (v === tile.key ? null : v))}
              className="font-body text-[10px] text-steel uppercase tracking-wide mt-2 cursor-default"
            >
              {tile.key === "clients" ? (
                <SwappableTerm termKey="client" form="plural" className="capitalize" />
              ) : (
                current.label
              )}
            </p>
            {peekTile === tile.key && alternates.length > 0 && (
              <div
                onMouseEnter={() => setPeekTile(tile.key)}
                onMouseLeave={() => setPeekTile(null)}
                className="absolute z-30 top-full left-1/2 -translate-x-1/2 mt-1 bg-graphite border border-steel/30 py-1 min-w-[160px] shadow-lg text-left"
              >
                {alternates.map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => pick(tile.key, v.key)}
                    className="w-full flex items-center justify-between gap-3 px-3 py-1.5 font-body text-xs text-chalk active:text-rust whitespace-nowrap"
                  >
                    <span className="text-steel">{v.label}</span>
                    <span>{v.display}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
