"use client";

import { useRouter } from "next/navigation";
import { QuickViewBubble } from "./quick-view-bubble";
import type { DueRosterEntry } from "@/lib/todays-due-roster";

// The 3 preset complications on the coach mobile Home (coach_mobile_
// app_redesign_plan.md) — real numbers, real inline action where the
// action is simple enough (logging a client straight from the bubble),
// "go deeper" for the rest. Preset, not configurable — a calmer version
// than the desktop rail's own eventual per-tile widgets.
function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-steel/20 p-3">
      <p className="font-body text-[10px] text-steel uppercase tracking-wide">{label}</p>
      <p className="font-display text-lg leading-none mt-1 truncate">{value}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-display text-lg leading-none">{value}</p>
      <p className="font-body text-[10px] text-steel uppercase mt-1">{label}</p>
    </div>
  );
}

export function CoachHomeComplications({
  groupId,
  revenueToday,
  revenueWeek,
  mrr,
  dueRoster,
}: {
  groupId: string;
  revenueToday: number;
  revenueWeek: number;
  mrr: number;
  dueRoster: DueRosterEntry[];
}) {
  const router = useRouter();
  const next = dueRoster[0] ?? null;

  function logNow(entry: DueRosterEntry) {
    router.push(`/groups/${groupId}/athletes/${entry.athleteId}/log/${entry.workoutId}`);
  }

  return (
    <div className="grid grid-cols-3 gap-2">
      <QuickViewBubble
        title="Revenue"
        deeperHref={`/groups/${groupId}/business`}
        deeperLabel="Open full Business dashboard"
        trigger={<Tile label="Today" value={`$${Math.round(revenueToday)}`} />}
      >
        {() => (
          <div className="grid grid-cols-3 gap-3 text-center">
            <Stat label="Today" value={`$${Math.round(revenueToday)}`} />
            <Stat label="This week" value={`$${Math.round(revenueWeek)}`} />
            <Stat label="MRR" value={`$${Math.round(mrr)}`} />
          </div>
        )}
      </QuickViewBubble>

      <QuickViewBubble
        title="Next Session"
        deeperHref={
          next
            ? `/groups/${groupId}/athletes/${next.athleteId}/log/${next.workoutId}`
            : `/groups/${groupId}/clients`
        }
        deeperLabel={next ? "Open full logging screen" : "Open Roster"}
        trigger={<Tile label="Next" value={next ? next.fullName : "None due"} />}
      >
        {(close) =>
          next ? (
            <div className="space-y-3">
              <div>
                <p className="font-body text-sm text-chalk">{next.fullName}</p>
                <p className="font-body text-xs text-steel">{next.workoutTitle ?? "Workout"}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  close();
                  logNow(next);
                }}
                className="h-9 px-4 bg-rust text-graphite font-body text-xs font-medium"
              >
                Log now
              </button>
            </div>
          ) : (
            <p className="font-body text-sm text-steel">No one due right now.</p>
          )
        }
      </QuickViewBubble>

      <QuickViewBubble
        title="Sessions Remaining"
        deeperHref={`/groups/${groupId}/clients`}
        deeperLabel="Open Roster"
        trigger={<Tile label="Remaining" value={String(dueRoster.length)} />}
      >
        {(close) =>
          dueRoster.length === 0 ? (
            <p className="font-body text-sm text-steel">Everyone&apos;s logged for today.</p>
          ) : (
            <div className="space-y-2">
              {dueRoster.map((entry) => (
                <div
                  key={entry.athleteId}
                  className="flex items-center justify-between gap-2 border-b border-steel/15 pb-2 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="font-body text-sm text-chalk truncate">{entry.fullName}</p>
                    <p className="font-body text-[11px] text-steel truncate">{entry.workoutTitle ?? "Workout"}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      logNow(entry);
                    }}
                    className="h-8 px-3 border border-steel/30 text-steel font-body text-xs shrink-0"
                  >
                    Log
                  </button>
                </div>
              ))}
            </div>
          )
        }
      </QuickViewBubble>
    </div>
  );
}
