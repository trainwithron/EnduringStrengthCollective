"use client";

import { QuickViewBubble } from "./quick-view-bubble";
import { NeedsAttentionPanel, type NeedsAttentionItem } from "../desktop/needs-attention-panel";

// coach_mobile_v2_feature_spec.md item 2 — a swipeable row of exactly
// two complications (deliberately capped, not the desktop rail's own
// eventual per-tile widget system): Needs Attention (inline assign/
// dismiss, reusing the same NeedsAttentionPanel + its real handlers
// verbatim rather than re-deriving them) and a Business glance. Used to
// show Next Session/Sessions Remaining too, but those duplicate the
// "Due today" hero block already above this row on the same screen —
// dropped rather than kept redundant.
function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-steel/20 p-3 w-40 shrink-0 snap-start">
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
  coachId,
  revenueToday,
  revenueWeek,
  mrr,
  activeClientCount,
  needsAttentionItems,
}: {
  groupId: string;
  coachId: string;
  revenueToday: number;
  revenueWeek: number;
  mrr: number;
  activeClientCount: number;
  needsAttentionItems: NeedsAttentionItem[];
}) {
  return (
    <div className="flex overflow-x-auto snap-x snap-mandatory gap-2 pb-1">
      <QuickViewBubble
        title="Needs Attention"
        deeperHref={`/groups/${groupId}/dashboard`}
        deeperLabel="Open full Dashboard"
        trigger={<Tile label="Needs attention" value={String(needsAttentionItems.length)} />}
      >
        {() =>
          needsAttentionItems.length === 0 ? (
            <p className="font-body text-sm text-steel">Nothing needs a look right now.</p>
          ) : (
            <NeedsAttentionPanel coachId={coachId} items={needsAttentionItems} />
          )
        }
      </QuickViewBubble>

      <QuickViewBubble
        title="Business"
        deeperHref={`/groups/${groupId}/business`}
        deeperLabel="Open full Business dashboard"
        trigger={<Tile label="MRR" value={`$${Math.round(mrr)}`} />}
      >
        {() => (
          <div className="grid grid-cols-2 gap-3 text-center">
            <Stat label="MRR" value={`$${Math.round(mrr)}`} />
            <Stat label="Active clients" value={String(activeClientCount)} />
            <Stat label="Today" value={`$${Math.round(revenueToday)}`} />
            <Stat label="This week" value={`$${Math.round(revenueWeek)}`} />
          </div>
        )}
      </QuickViewBubble>
    </div>
  );
}
