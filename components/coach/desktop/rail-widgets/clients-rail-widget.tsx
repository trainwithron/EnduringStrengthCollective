"use client";

import { useEffect, useState } from "react";
import type { NeedsAttentionItem } from "../needs-attention-panel";
import { RailWidgetHeader, RailWidgetDeeperLink, RailWidgetEmpty, RailWidgetLoading } from "./rail-widget-shell";

// Hover rail widgets (hover_expand_rail_widgets_idea.md) — Clients icon.
// Fetches the exact same canonical endpoint NeedsAttentionStrip already
// uses (GET /api/coach/needs-attention) rather than a fresh "who needs
// attention" query — the same bug class already fixed twice this
// project (Calendar's own quiet-tier disagreement, the stale-client-name
// bug's independent acting-as checks). Nutrition folds in here too, per
// spec — macros_missing is already one of this endpoint's two trigger
// kinds, so no separate widget or extra fetch is needed for it.
const MAX_ROWS = 3;

export function ClientsRailWidget({ groupId }: { groupId: string }) {
  const [items, setItems] = useState<NeedsAttentionItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const res = await fetch(`/api/coach/needs-attention?groupId=${groupId}`);
      const data = await res.json().catch(() => ({ items: [] }));
      if (!cancelled) setItems(data.items ?? []);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  return (
    <div>
      <RailWidgetHeader title="Needs attention" />
      {items === null ? (
        <RailWidgetLoading />
      ) : items.length === 0 ? (
        <RailWidgetEmpty text="Nothing needs a look right now." />
      ) : (
        <div>
          {items.slice(0, MAX_ROWS).map((item) => (
            <p
              key={`${item.athleteId}::${item.triggerKey}`}
              className="font-body text-sm text-chalk truncate py-1 border-b border-steel/10 last:border-b-0"
            >
              {item.title}
            </p>
          ))}
          {items.length > MAX_ROWS && (
            <p className="font-body text-xs text-steel pt-1.5">+ {items.length - MAX_ROWS} more</p>
          )}
        </div>
      )}
      <RailWidgetDeeperLink href={`/groups/${groupId}/clients`} label="Open Clients" />
    </div>
  );
}
