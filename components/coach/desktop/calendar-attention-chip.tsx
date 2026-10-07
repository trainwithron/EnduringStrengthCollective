"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";
import {
  attentionPage,
  CALENDAR_ATTENTION_KIND,
  CALENDAR_ATTENTION_SNOOZE_DAYS,
  snoozeRows,
  snoozedAttentionKeys,
  visibleAttention,
  type AttentionItem,
} from "@/lib/calendar-attention";
import { QUIET_SNOOZE_KIND } from "@/lib/quiet-snooze";

// "Needs attention" on the calendar, as one small chip that opens to three rows at a time (Ron, Oct 6: a long list was taking over the top of the rail).
// Each row can be snoozed for a week, or all of them together. Quiet-client rows share Home's snooze, so quieting one place quiets both.
export function CalendarAttentionChip({ items }: { items: AttentionItem[] }) {
  const [snoozed, setSnoozed] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [coachId, setCoachId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      if (!cancelled) setCoachId(user.id);
      // If this cannot load, nothing is hidden: the list just shows everything.
      const { data } = await supabase
        .from("spotter_recommendation_feedback")
        .select("dismissal_key, created_at")
        .eq("coach_id", user.id)
        .in("spotter_kind", [QUIET_SNOOZE_KIND, CALENDAR_ATTENTION_KIND])
        .order("created_at", { ascending: false })
        .limit(1000);
      if (!cancelled) setSnoozed(snoozedAttentionKeys((data ?? []) as { dismissal_key: string; created_at: string }[], new Date()));
    }
    load().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function snooze(list: AttentionItem[]) {
    if (!coachId || list.length === 0) return;
    setBusy(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: insertError } = await supabase.from("spotter_recommendation_feedback").insert(snoozeRows(coachId, list));
    setBusy(false);
    if (insertError) {
      setError("That didn't save. Nothing was snoozed.");
      return;
    }
    setSnoozed((prev) => {
      const next = new Set(prev);
      for (const i of list) next.add(i.key);
      return next;
    });
  }

  const left = visibleAttention(items, snoozed);
  if (left.length === 0) return null;
  const { shown, remaining } = attentionPage(left, page);

  return (
    <div className="mb-4 border border-rust/30 bg-rust/5">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex items-center gap-2 min-h-[32px] font-body text-sm text-chalk">
          <span aria-hidden="true">{open ? "▾" : "▸"}</span>
          {left.length} {left.length === 1 ? "needs" : "need"} attention
        </button>
        {open && left.length > 1 && (
          <button type="button" onClick={() => snooze(left)} disabled={busy || !coachId} className="font-body text-xs text-steel underline underline-offset-2 disabled:opacity-40">
            {busy ? "Clearing…" : `Clear all for ${CALENDAR_ATTENTION_SNOOZE_DAYS} days`}
          </button>
        )}
      </div>
      {open && (
        <div className="border-t border-steel/15 px-3">
          <ul className="divide-y divide-steel/15">
            {shown.map((i) => (
              <li key={i.key} className="py-2 flex items-start justify-between gap-2">
                <Link href={i.href} className="font-body text-xs text-chalk hover:text-rust min-w-0 flex-1">
                  {i.label}
                </Link>
                <button
                  type="button"
                  onClick={() => snooze([i])}
                  disabled={busy || !coachId}
                  className="shrink-0 h-7 px-2 border border-steel/30 text-steel font-body text-[11px] disabled:opacity-40"
                >
                  Snooze
                </button>
              </li>
            ))}
          </ul>
          {remaining > 0 && (
            <button type="button" onClick={() => setPage((p) => p + 1)} className="my-2 font-body text-xs text-rust underline underline-offset-2">
              Show {Math.min(3, remaining)} more ({remaining} left)
            </button>
          )}
          {error && <p className="font-body text-xs text-rust pb-2">{error}</p>}
        </div>
      )}
    </div>
  );
}
