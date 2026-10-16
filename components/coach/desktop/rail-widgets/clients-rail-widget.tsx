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
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const res = await fetch(`/api/coach/needs-attention?groupId=${groupId}`).catch(() => null);
      const data = res && res.ok ? await res.json().catch(() => null) : null;
      if (cancelled) return;
      // A failed check is never shown as "nothing needs a look".
      if (!data || !Array.isArray(data.items)) setFailed(true);
      else setItems(data.items);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  return (
    <div>
      <RailWidgetHeader title="Needs attention" />
      {failed ? (
        <RailWidgetEmpty text="Couldn't check. Open Clients to see." />
      ) : items === null ? (
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
      <RailWidgetDeeperLink href="/clients" label="Open Clients" />
    </div>
  );
}
