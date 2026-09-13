"use client";

import { useState } from "react";
import { X, ChevronUp, ChevronDown, Settings2 } from "lucide-react";
import { computeVisibleTileOrder, DEFAULT_TILE_ORDER, type DashboardTileKey } from "@/lib/dashboard-layout";

export interface DashboardTileDef {
  key: DashboardTileKey;
  label: string;
  node: React.ReactNode;
}

// Android widget-drawer customization for the bento grid below the hero
// (coach_dashboard_redesign_scoping.md) — show/hide + reorder only, no
// resizing or widget library. Ships in the fixed default order with zero
// configuration; the "Customize" toggle is the only place hide/reorder
// controls ever appear. The hero row above this grid is never part of
// this component at all — it's rendered separately by the page and
// isn't customizable.
export function DashboardTileGrid({
  tiles,
  initialOrder,
  initialHidden,
}: {
  tiles: DashboardTileDef[];
  initialOrder: string[];
  initialHidden: string[];
}) {
  const [visibleOrder, setVisibleOrder] = useState<DashboardTileKey[]>(
    computeVisibleTileOrder(initialOrder, initialHidden)
  );
  const [hidden, setHidden] = useState<string[]>(initialHidden.filter((k) => (DEFAULT_TILE_ORDER as readonly string[]).includes(k)));
  const [customizing, setCustomizing] = useState(false);

  const tileByKey = new Map(tiles.map((t) => [t.key, t]));

  function persist(nextOrder: DashboardTileKey[], nextHidden: string[]) {
    fetch("/api/coach/dashboard-layout", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tileOrder: nextOrder, hiddenTiles: nextHidden }),
    }).catch(() => {});
  }

  function hideTile(key: DashboardTileKey) {
    const nextOrder = visibleOrder.filter((k) => k !== key);
    const nextHidden = [...hidden, key];
    setVisibleOrder(nextOrder);
    setHidden(nextHidden);
    persist(nextOrder, nextHidden);
  }

  function unhideTile(key: string) {
    const nextHidden = hidden.filter((k) => k !== key);
    const nextOrder = [...visibleOrder, key as DashboardTileKey];
    setHidden(nextHidden);
    setVisibleOrder(nextOrder);
    persist(nextOrder, nextHidden);
  }

  function move(key: DashboardTileKey, direction: -1 | 1) {
    const index = visibleOrder.indexOf(key);
    const swapWith = index + direction;
    if (swapWith < 0 || swapWith >= visibleOrder.length) return;
    const next = [...visibleOrder];
    [next[index], next[swapWith]] = [next[swapWith], next[index]];
    setVisibleOrder(next);
    persist(next, hidden);
  }

  return (
    <div>
      <div className="flex justify-end mb-2">
        <button
          type="button"
          onClick={() => setCustomizing((v) => !v)}
          className={`flex items-center gap-1.5 font-body text-xs px-2 py-1 border ${
            customizing ? "border-rust text-rust bg-rust/10" : "border-steel/30 text-steel"
          }`}
        >
          <Settings2 className="w-3.5 h-3.5" />
          {customizing ? "Done" : "Customize"}
        </button>
      </div>

      <div className="space-y-4">
        {visibleOrder.map((key, i) => {
          const tile = tileByKey.get(key);
          if (!tile) return null;
          return (
            <div key={key} className="relative">
              {customizing && (
                <div className="flex items-center justify-between mb-1 px-1">
                  <p className="font-body text-[10px] text-steel uppercase tracking-wide">{tile.label}</p>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => move(key, -1)}
                      disabled={i === 0}
                      className="w-6 h-6 flex items-center justify-center text-steel disabled:opacity-30"
                      aria-label={`Move ${tile.label} up`}
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(key, 1)}
                      disabled={i === visibleOrder.length - 1}
                      className="w-6 h-6 flex items-center justify-center text-steel disabled:opacity-30"
                      aria-label={`Move ${tile.label} down`}
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => hideTile(key)}
                      className="w-6 h-6 flex items-center justify-center text-rust"
                      aria-label={`Hide ${tile.label}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
              {tile.node}
            </div>
          );
        })}
      </div>

      {customizing && hidden.length > 0 && (
        <div className="mt-4 border border-steel/20 border-dashed p-3">
          <p className="font-body text-[10px] text-steel uppercase tracking-wide mb-2">Hidden — tap to add back</p>
          <div className="flex flex-wrap gap-2">
            {hidden.map((key) => {
              const tile = tileByKey.get(key as DashboardTileKey);
              if (!tile) return null;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => unhideTile(key)}
                  className="font-body text-xs text-steel border border-steel/30 px-2 py-1 active:border-rust active:text-rust"
                >
                  + {tile.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
