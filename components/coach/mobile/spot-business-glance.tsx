"use client";

import { useEffect, useState } from "react";
import { QuickViewBubble } from "./quick-view-bubble";
import { ViewAsClientPicker } from "@/components/athlete/view-as-client-picker";

// the_spot_dropdown_widget_redesign_sept16.md — the Spot's top-anchored
// widget bar: the default panel shown when the Spot opens generally (not
// while impersonating anyone). Roster-wide glance across this group,
// reusing QuickViewBubble verbatim per tile (the already-shipped
// complications pattern), same as components/coach/mobile/the-spot-rail.tsx
// does for its own single-client tiles. "View as Client" lives here now
// as an action tile — the capability the old standalone button gave
// still exists, it just moved inside the Spot rather than being a
// second competing entry point.
interface SpotGlanceData {
  lowCreditsClients: { id: string; name: string; balance: number }[];
  incompleteWaiverClients: { id: string; name: string }[];
  support: { openCount: number; openRequests: { id: string; subject: string; createdAt: string }[] };
  mrr: number;
}

function Tile({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`border p-3 w-40 shrink-0 snap-start ${warn ? "border-rust/60 bg-rust/5" : "border-steel/20"}`}>
      <p className="font-body text-[10px] text-steel uppercase tracking-wide">{label}</p>
      <p className={`font-display text-lg leading-none mt-1 truncate ${warn ? "text-rust" : ""}`}>{value}</p>
    </div>
  );
}

export function SpotBusinessGlance({ groupId, onClose }: { groupId: string; onClose: () => void }) {
  const [data, setData] = useState<SpotGlanceData | null>(null);
  const [showViewAsClient, setShowViewAsClient] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/coach/spot-glance?groupId=${groupId}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && !d.error) setData(d);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  return (
    <div className="space-y-3">
      <div className="flex overflow-x-auto snap-x snap-mandatory gap-2 pb-1">
        <QuickViewBubble
          title="Business — MRR"
          deeperHref={`/groups/${groupId}/business`}
          deeperLabel="Open Business dashboard"
          trigger={<Tile label="MRR" value={data ? `$${data.mrr.toFixed(0)}` : "…"} />}
        >
          {() => (
            <p className="font-body text-sm text-chalk">
              ${data?.mrr.toFixed(2) ?? "0.00"} in active recurring revenue across your business.
            </p>
          )}
        </QuickViewBubble>

        <QuickViewBubble
          title="Clients Low on Credits"
          trigger={
            <Tile
              label="Low credits"
              value={data ? String(data.lowCreditsClients.length) : "…"}
              warn={!!data && data.lowCreditsClients.length > 0}
            />
          }
        >
          {(close) => (
            <div className="space-y-2">
              {!data || data.lowCreditsClients.length === 0 ? (
                <p className="font-body text-sm text-steel">Nobody&apos;s low right now.</p>
              ) : (
                <ul className="space-y-1.5">
                  {data.lowCreditsClients.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2">
                      <span className="font-body text-sm text-chalk truncate">{c.name}</span>
                      <span className="font-body text-xs text-rust shrink-0">{c.balance} left</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </QuickViewBubble>

        <QuickViewBubble
          title="Incomplete Waivers"
          trigger={
            <Tile
              label="Waivers"
              value={data ? `${data.incompleteWaiverClients.length} open` : "…"}
              warn={!!data && data.incompleteWaiverClients.length > 0}
            />
          }
        >
          {() => (
            <div className="space-y-2">
              {!data || data.incompleteWaiverClients.length === 0 ? (
                <p className="font-body text-sm text-steel">Everyone&apos;s squared away.</p>
              ) : (
                <ul className="space-y-1.5">
                  {data.incompleteWaiverClients.map((c) => (
                    <li key={c.id} className="font-body text-sm text-chalk truncate">
                      {c.name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </QuickViewBubble>

        <QuickViewBubble
          title="Support Inbox"
          deeperHref={`/groups/${groupId}/business/support`}
          deeperLabel="Open full inbox"
          trigger={
            <Tile
              label="Support"
              value={data ? (data.support.openCount === 0 ? "0 open" : `${data.support.openCount} open`) : "…"}
              warn={!!data && data.support.openCount > 0}
            />
          }
        >
          {() => (
            <div className="space-y-2">
              {!data || data.support.openRequests.length === 0 ? (
                <p className="font-body text-sm text-steel">No open requests.</p>
              ) : (
                <ul className="space-y-1.5">
                  {data.support.openRequests.map((r) => (
                    <li key={r.id} className="font-body text-sm text-chalk truncate">
                      {r.subject}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </QuickViewBubble>
      </div>

      <button
        type="button"
        onClick={() => setShowViewAsClient(true)}
        className="w-full h-10 border border-steel/30 text-chalk font-body text-sm active:border-rust active:text-rust transition-colors"
      >
        View as Client →
      </button>

      {showViewAsClient && (
        <ViewAsClientPicker
          onClose={() => {
            setShowViewAsClient(false);
            onClose();
          }}
        />
      )}
    </div>
  );
}
