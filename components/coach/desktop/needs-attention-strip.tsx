"use client";

import { readRowsByIds } from "@/lib/read-by-ids";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { useOrgGroupIds } from "@/lib/use-org-group-ids";
import { NeedsAttentionPanel, type NeedsAttentionItem } from "./needs-attention-panel";
import { pickIdleSlotContent, type IdleSlotContent } from "@/lib/shell-idle-content";

const CATEGORY_LABEL: Record<IdleSlotContent["category"], string> = {
  client_win: "Client win",
  business_tip: "Business tip",
  revenue_idea: "Revenue idea",
  coach_training_nudge: "Your own training",
  fun_fact: "Did you know",
};

// The coach-desktop-shell's pinned strip (coach_desktop_shell_identity_
// redesign.md, items 5-6) — a constant fixture at the top of the list
// panel regardless of whether the roster or the Business mini-dashboard
// is showing below it. Real flagged items (program ending / macros
// missing) reuse the exact NeedsAttentionPanel already shipped on the
// Dashboard page; on a genuine zero-flag day, it rotates in one of five
// categories instead of going blank — a real recent PR when one exists,
// else a deterministic-per-day pick from the idle content bank.
export function NeedsAttentionStrip({ coachId, groupId }: { coachId: string; groupId: string }) {
  const groupIds = useOrgGroupIds(groupId);
  const [items, setItems] = useState<NeedsAttentionItem[] | null>(null);
  const [idleContent, setIdleContent] = useState<IdleSlotContent | null>(null);
  // "Nothing needs attention" is only said when the check really came back empty; a failed check says so.
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!groupIds || groupIds.length === 0) return;
    let cancelled = false;
    async function run() {
      const res = await fetch(`/api/coach/needs-attention?groupIds=${groupIds!.join(",")}`).catch(() => null);
      const data = res && res.ok ? await res.json().catch(() => null) : null;
      if (cancelled) return;
      if (!data || !Array.isArray(data.items)) {
        setFailed(true);
        return;
      }
      setFailed(false);
      const realItems: NeedsAttentionItem[] = data.items;
      setItems(realItems);

      if (realItems.length === 0) {
        // Real client win first: any PR logged by this group's roster in
        // the last 7 days — a genuine "something positive to shout out,"
        // not a fabricated one. Falls back to the deterministic idle
        // content pool when nothing real is available.
        const supabase = createBrowserClient();
        const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
        const { data: prRowsAll } = await readRowsByIds(
          groupIds!,
          (g) => (from, to) =>
            supabase
              .from("workout_logs")
              .select("new_prs, created_at, profiles ( full_name )")
              .in("group_id", g)
              .gt("created_at", sevenDaysAgo)
              .not("new_prs", "is", null)
              .order("created_at", { ascending: false })
              .order("id")
              .range(from, to),
          { pageSize: 20, maxPages: 1 }
        );
        const prRows = prRowsAll.sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 20);

        const withPrs = (prRows ?? []).find((r: any) => (r.new_prs ?? []).length > 0);
        if (!cancelled) {
          if (withPrs) {
            const name = (withPrs as any).profiles?.full_name ?? "A client";
            const prName = (withPrs as any).new_prs[0];
            setIdleContent({
              category: "client_win",
              text: `${name} just set a new PR on ${prName} — worth a quick shoutout in Team Feed.`,
            });
          } else {
            // Stable within a day (doesn't flicker on reload), varied
            // across days and across coaches/groups.
            setIdleContent(pickIdleSlotContent(`${coachId}:${groupId}:${new Date().toISOString().slice(0, 10)}`));
          }
        }
      }
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
          className="mt-1 min-h-9 font-body text-xs text-rust underline underline-offset-2"
        >
          Try again
        </button>
      </div>
    );
  }

  if (items === null) return null; // Still loading — no flash of empty state.

  if (items.length > 0) {
    return <NeedsAttentionPanel coachId={coachId} items={items} />;
  }

  if (!idleContent) return null;

  return (
    <div className="border border-steel/20 bg-surface/30 p-3 mb-3">
      <p className="font-body text-xs text-steel uppercase tracking-wide mb-1">
        {CATEGORY_LABEL[idleContent.category]}
      </p>
      <p className="font-body text-xs text-chalk leading-snug">{idleContent.text}</p>
    </div>
  );
}
