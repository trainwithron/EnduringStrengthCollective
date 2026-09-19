"use client";

import { useEffect, useState } from "react";
import { QuickViewBubble } from "./quick-view-bubble";

// the_spot_dropdown_widget_redesign_sept16.md "REVISED 2026-09-19" —
// swipe-left panel of the Spot's 3-panel structure. Reuses the roster-
// wide business glance shipped 9/16 (spot-glance API, QuickViewBubble
// tiles) verbatim — the "View as Client" action tile that used to live
// here moved to the new default/center panel (spot-clients-groups-panel.tsx),
// since View-as is now the primary entry point, not folded into this
// secondary glance. New addition: a glanceable upcoming-sessions list.
interface SpotGlanceData {
  lowCreditsClients: { id: string; name: string; balance: number }[];
  incompleteWaiverClients: { id: string; name: string }[];
  support: { openCount: number; openRequests: { id: string; subject: string; createdAt: string }[] };
  mrr: number;
  upcomingSessions: { id: string; athleteName: string; startAt: string }[];
}

function Tile({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`border p-3 w-40 shrink-0 snap-start ${warn ? "border-rust/60 bg-rust/5" : "border-steel/20"}`}>
      <p className="font-body text-[10px] text-steel uppercase tracking-wide">{label}</p>
      <p className={`font-display text-lg leading-none mt-1 truncate ${warn ? "text-rust" : ""}`}>{value}</p>
    </div>
  );
}

function formatSessionTime(startAt: string): string {
  const d = new Date(startAt);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return isToday ? time : `${d.toLocaleDateString("en-US", { weekday: "short" })} ${time}`;
}

export function SpotBusinessPanel({ groupId }: { groupId: string }) {
  const [data, setData] = useState<SpotGlanceData | null>(null);

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
    <div className="space-y-4">
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
          {() => (
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

      <div>
        <p className="font-body text-[10px] text-steel uppercase tracking-wide mb-2">Upcoming sessions</p>
        {!data ? (
          <p className="font-body text-sm text-steel">…</p>
        ) : data.upcomingSessions.length === 0 ? (
          <p className="font-body text-sm text-steel">Nothing booked yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {data.upcomingSessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 border-b border-steel/10 pb-1.5 last:border-b-0 last:pb-0">
                <span className="font-body text-sm text-chalk truncate">{s.athleteName}</span>
                <span className="font-body text-xs text-steel shrink-0">{formatSessionTime(s.startAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
