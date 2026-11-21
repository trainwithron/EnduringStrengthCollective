"use client";

import { useEffect, useState } from "react";
import { useOrgGroupIds } from "@/lib/use-org-group-ids";
import { NeedsAttentionPanel, type NeedsAttentionItem } from "./needs-attention-panel";

// The side panel's pinned strip (coach_desktop_shell_identity_redesign.md, items 5-6): the real flagged items (program ending / macros missing), in the same NeedsAttentionPanel
// the group dashboard shows. On a day with nothing flagged it shows nothing: no tips, ideas or fun facts in a spot meant for action (clutter audit DK6, Nov 21).
export function NeedsAttentionStrip({ coachId, groupId }: { coachId: string; groupId: string }) {
  const groupIds = useOrgGroupIds(groupId);
  const [items, setItems] = useState<NeedsAttentionItem[] | null>(null);
  // "Nothing needs attention" is only said when the check really came back empty; a failed check says so.
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!groupIds || groupIds.length === 0) return;
    let cancelled = false;
    async function run() {
      // (The group ids go in the body: a coach with 1,500 groups would send an address too long to be accepted.)
      const res = await fetch("/api/coach/needs-attention", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ groupIds }) }).catch(() => null);
      const data = res && res.ok ? await res.json().catch(() => null) : null;
      if (cancelled) return;
      if (!data || !Array.isArray(data.items)) {
        setFailed(true);
        return;
      }
      setFailed(false);
      setItems(data.items as NeedsAttentionItem[]);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [coachId, groupId, groupIds, attempt]);

  if (failed) {
    return (
      <div className="border border-rust/40 bg-surface/30 p-3 mb-3" role="alert">
        <p className="font-body text-xs text-chalk leading-snug">Couldn&apos;t check what needs your attention.</p>
        <button
          type="button"
          onClick={() => {
            setFailed(false);
            setAttempt((n) => n + 1);
          }}
          className="mt-1 min-h-9 font-body text-xs text-rust-ink underline underline-offset-2"
        >
          Try again
        </button>
      </div>
    );
  }

  // Still loading, or nothing flagged: nothing at all.
  if (!items || items.length === 0) return null;
  return <NeedsAttentionPanel coachId={coachId} items={items} />;
}
