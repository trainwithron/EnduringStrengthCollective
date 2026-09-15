"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { QuickViewBubble } from "./quick-view-bubble";
import type { SpotWidgetKey } from "@/lib/spot-widgets";

// "The Spot" (coach_only_widget_hub_the_spot.md) — coach-only, sits on
// top of the true-mirror View-As-Client screen, never visible to the
// client themselves (only ever rendered by a caller that already
// confirmed isActingAsOther — the "Clark Kent rule": this component has
// no opinion of its own on who's allowed to see it, same as
// ActingAsBanner). v1 widget set, confirmed by Ron: credits/packages
// running low, waiver/intake gaps, support inbox — plain data glances,
// not Spotter-synthesized (that's an explicit later pass). Reuses
// QuickViewBubble verbatim, the same swipeable tap-to-expand shell
// CoachHomeComplications already uses, rather than inventing a new
// interaction for this rail.

export interface SpotCreditsData {
  balance: number;
  activeSubscriptionRenewsAt: string | null;
}
export interface SpotWaiverData {
  required: boolean;
  completed: boolean;
}
export interface SpotSupportRequest {
  id: string;
  subject: string;
  createdAt: string;
}
export interface SpotSupportData {
  openCount: number;
  openRequests: SpotSupportRequest[];
}

function Tile({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div
      className={`border p-3 w-40 shrink-0 snap-start ${
        warn ? "border-rust/60 bg-rust/5" : "border-steel/20"
      }`}
    >
      <p className="font-body text-[10px] text-steel uppercase tracking-wide">{label}</p>
      <p className={`font-display text-lg leading-none mt-1 truncate ${warn ? "text-rust" : ""}`}>{value}</p>
    </div>
  );
}

function HideWidgetLink({
  widgetKey,
  currentHidden,
  close,
}: {
  widgetKey: SpotWidgetKey;
  currentHidden: SpotWidgetKey[];
  close: () => void;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function hide() {
    setSaving(true);
    try {
      await fetch("/api/coach/dashboard-layout", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spotHiddenWidgets: [...currentHidden, widgetKey] }),
      });
      close();
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <button
      type="button"
      onClick={hide}
      disabled={saving}
      className="font-body text-[11px] text-steel underline underline-offset-2 disabled:opacity-40"
    >
      {saving ? "Hiding…" : "Hide this from the Spot"}
    </button>
  );
}

export function TheSpotRail({
  groupId,
  visibleWidgets,
  hiddenWidgets,
  credits,
  waiver,
  support,
}: {
  groupId: string;
  visibleWidgets: SpotWidgetKey[];
  hiddenWidgets: SpotWidgetKey[];
  credits: SpotCreditsData;
  waiver: SpotWaiverData;
  support: SpotSupportData;
}) {
  const showCredits = visibleWidgets.includes("credits");
  // A client never required to complete intake (every account created
  // before this feature shipped) has nothing to glean here — the tile
  // simply doesn't apply, regardless of the coach's own show/hide
  // preference for the widget generally.
  const showWaiver = visibleWidgets.includes("waiver") && waiver.required;
  const showSupport = visibleWidgets.includes("support");

  if (!showCredits && !showWaiver && !showSupport) return null;

  return (
    <div className="px-5 pt-3">
      <p className="font-body text-[10px] text-steel uppercase tracking-wide mb-1.5">
        The Spot — only you can see this
      </p>
      <div className="flex overflow-x-auto snap-x snap-mandatory gap-2 pb-1">
        {showCredits && (
          <QuickViewBubble
            title="Credits & Membership"
            trigger={
              <Tile
                label="Credits"
                value={String(credits.balance)}
                warn={credits.balance <= 1 && !credits.activeSubscriptionRenewsAt}
              />
            }
          >
            {(close) => (
              <div className="space-y-3">
                <p className="font-body text-sm text-chalk">
                  {credits.balance} session credit{credits.balance === 1 ? "" : "s"} remaining.
                </p>
                {credits.activeSubscriptionRenewsAt ? (
                  <p className="font-body text-xs text-steel">
                    Active membership renews{" "}
                    {new Date(credits.activeSubscriptionRenewsAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                    .
                  </p>
                ) : credits.balance <= 1 ? (
                  <p className="font-body text-xs text-rust">
                    Low on credits with no active membership — worth a check-in before their next session.
                  </p>
                ) : null}
                <HideWidgetLink widgetKey="credits" currentHidden={hiddenWidgets} close={close} />
              </div>
            )}
          </QuickViewBubble>
        )}

        {showWaiver && (
          <QuickViewBubble
            title="Waiver & Intake"
            trigger={
              <Tile
                label="Intake"
                value={waiver.completed ? "Complete" : "Incomplete"}
                warn={!waiver.completed}
              />
            }
          >
            {(close) => (
              <div className="space-y-3">
                <p className="font-body text-sm text-chalk">
                  PAR-Q+ & waiver:{" "}
                  <span className={waiver.completed ? "text-chalk" : "text-rust"}>
                    {waiver.completed ? "Signed" : "Not yet completed"}
                  </span>
                </p>
                {!waiver.completed && (
                  <p className="font-body text-xs text-steel">
                    They&apos;ll be prompted for this the next time they sign in.
                  </p>
                )}
                <HideWidgetLink widgetKey="waiver" currentHidden={hiddenWidgets} close={close} />
              </div>
            )}
          </QuickViewBubble>
        )}

        {showSupport && (
          <QuickViewBubble
            title="Support Inbox"
            deeperHref={`/groups/${groupId}/business/support`}
            deeperLabel="Open full inbox"
            trigger={
              <Tile
                label="Support"
                value={support.openCount === 0 ? "0 open" : `${support.openCount} open`}
                warn={support.openCount > 0}
              />
            }
          >
            {(close) => (
              <div className="space-y-3">
                {support.openRequests.length === 0 ? (
                  <p className="font-body text-sm text-steel">No open requests.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {support.openRequests.map((r) => (
                      <li key={r.id} className="font-body text-sm text-chalk truncate">
                        {r.subject}
                      </li>
                    ))}
                  </ul>
                )}
                <HideWidgetLink widgetKey="support" currentHidden={hiddenWidgets} close={close} />
              </div>
            )}
          </QuickViewBubble>
        )}
      </div>
    </div>
  );
}
