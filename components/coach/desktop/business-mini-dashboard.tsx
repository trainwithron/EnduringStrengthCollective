"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";
import { useOrgGroupIds } from "@/lib/use-org-group-ids";
import {
  computeRealIncomeThisMonth,
  computeRealMRR,
  computeActivePayingClients,
  computeEngagement,
} from "@/lib/business-metrics";

interface MiniBusinessData {
  incomeThisMonth: number;
  mrr: number;
  payingClients: number;
}

interface ExpandedBusinessData {
  rosterSize: number;
  activeThisWeek: number;
  activePct: number;
}

// The "pin a real Business mini-dashboard in place of the roster"
// picture-in-picture panel (coach_desktop_shell_identity_redesign.md,
// item 2) — real numbers via the same pure lib/business-metrics.ts
// functions the full Business page uses, at a scope this coach can
// glance at without leaving whatever page they're actually on. "Go
// deeper" links to the full page for the real charts/roster-level
// detail this compact view deliberately doesn't try to replicate.
// `expanded` — the floating-card-stack widget's "drag/resize should be
// functionally meaningful, not purely cosmetic" ask: past a real height
// threshold, this view shows two more real tiles instead of just extra
// whitespace. Roster/Calendar/Program already grow useful content with
// more room (they're plain scrollable lists) — Business was the one
// mini-view with genuinely fixed content regardless of card size, so
// it's the one that needed an actual `expanded` branch.
export function BusinessMiniDashboard({ groupId, expanded = false }: { groupId: string; expanded?: boolean }) {
  // Every group the coach has in this organization (not just the one in the URL).
  const groupIds = useOrgGroupIds(groupId);
  const [data, setData] = useState<MiniBusinessData | null>(null);
  const [expandedData, setExpandedData] = useState<ExpandedBusinessData | null>(null);

  useEffect(() => {
    if (!groupIds) return;
    let cancelled = false;
    async function run() {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const monthKey = new Date().toISOString().slice(0, 7);

      const [{ data: purchaseRows }, { data: quickPaymentRows }, { data: subRows }, { data: memberRows }] =
        await Promise.all([
          supabase
            .from("credit_purchases")
            .select("amount_cents, created_at, athlete_id")
            .in("group_id", groupIds!),
          // Quick Payment (mobile_more_tab_condensed_widget_hub_sept30.md)
          // — real money received, a separate table from credit_purchases
          // (no session credits granted), but it still belongs in "income
          // this month" alongside everything else.
          supabase
            .from("coach_quick_payments")
            .select("amount_cents, created_at, athlete_id")
            .in("group_id", groupIds!),
          supabase
            .from("membership_subscriptions")
            .select("price_cents, status, athlete_id")
            .in("group_id", groupIds!),
          supabase.from("group_memberships").select("profile_id").in("group_id", groupIds!).eq("role", "athlete"),
        ]);

      const incomeThisMonth = computeRealIncomeThisMonth(
        [...(purchaseRows ?? []), ...(quickPaymentRows ?? [])].map((r: any) => ({
          amountCents: r.amount_cents,
          createdAtDateKey: (r.created_at as string).slice(0, 10),
        })),
        monthKey
      );
      const mrr = computeRealMRR(
        (subRows ?? []).map((r: any) => ({ priceCents: r.price_cents, status: r.status }))
      );
      const athleteIds = new Set((memberRows ?? []).map((m: any) => m.profile_id));
      const payingClients = computeActivePayingClients([
        ...(purchaseRows ?? [])
          .filter((r: any) => athleteIds.has(r.athlete_id))
          .map((r: any) => ({ athleteId: r.athlete_id, hasActivePurchaseOrSub: true })),
        ...(quickPaymentRows ?? [])
          .filter((r: any) => athleteIds.has(r.athlete_id))
          .map((r: any) => ({ athleteId: r.athlete_id, hasActivePurchaseOrSub: true })),
        ...(subRows ?? [])
          .filter((r: any) => r.status === "active")
          .map((r: any) => ({ athleteId: r.athlete_id, hasActivePurchaseOrSub: true })),
      ]);

      if (!cancelled) setData({ incomeThisMonth, mrr, payingClients });
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [groupIds]);

  // Fetched lazily, only once the card is actually big enough to show
  // it — no point paying for this query at the default compact size.
  useEffect(() => {
    if (!expanded || !groupIds) return;
    let cancelled = false;
    async function run() {
      const supabase = createBrowserClient();

      const { data: memberRows } = await supabase
        .from("group_memberships")
        .select("profile_id")
        .in("group_id", groupIds!)
        .eq("role", "athlete");
      const athleteIds = [...new Set((memberRows ?? []).map((m: any) => m.profile_id as string))];

      const { data: logRows } =
        athleteIds.length > 0
          ? await supabase
              .from("workout_logs")
              .select("athlete_id, created_at")
              .in("athlete_id", athleteIds)
              .in("group_id", groupIds!)
              .order("created_at", { ascending: false })
          : { data: [] };

      const lastByAthlete = new Map<string, string>();
      for (const row of logRows ?? []) {
        if (!lastByAthlete.has(row.athlete_id)) lastByAthlete.set(row.athlete_id, row.created_at.slice(0, 10));
      }
      const engagement = computeEngagement(
        athleteIds.map((id: string) => ({ lastActiveDateKey: lastByAthlete.get(id) ?? null })),
        new Date().toISOString().slice(0, 10),
        7
      );

      if (!cancelled) {
        setExpandedData({
          rosterSize: athleteIds.length,
          activeThisWeek: engagement.activeCount,
          activePct: engagement.pct,
        });
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [groupIds, expanded]);

  return (
    <div className="space-y-3">
      {/* feature_redundancy_and_could_work_better_audit_sept29.md — the
          Business hover-rail widget shows this same-named metric scoped
          coach-wide (every group); this one is just the group currently
          being viewed, which a coach with more than one group has no way
          to tell apart otherwise. */}
      <p className="font-body text-[10px] uppercase tracking-wide text-steel -mt-1">
        Whole organization
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div className="border border-steel/20 p-2.5">
          <p className="font-display font-bold text-lg leading-none">
            {data ? `$${data.incomeThisMonth.toFixed(0)}` : "—"}
          </p>
          <p className="font-body text-[10px] text-steel uppercase mt-1">Income (mo)</p>
        </div>
        <div className="border border-steel/20 p-2.5">
          <p className="font-display font-bold text-lg leading-none">{data ? `$${data.mrr.toFixed(0)}` : "—"}</p>
          <p className="font-body text-[10px] text-steel uppercase mt-1">MRR</p>
        </div>
        <div className="border border-steel/20 p-2.5 col-span-2">
          <p className="font-display font-bold text-lg leading-none">{data ? data.payingClients : "—"}</p>
          <p className="font-body text-[10px] text-steel uppercase mt-1">Paying clients</p>
        </div>
        {expanded && (
          <>
            <div className="border border-steel/20 p-2.5">
              <p className="font-display font-bold text-lg leading-none">{expandedData ? expandedData.rosterSize : "—"}</p>
              <p className="font-body text-[10px] text-steel uppercase mt-1">Roster size</p>
            </div>
            <div className="border border-steel/20 p-2.5">
              <p className="font-display font-bold text-lg leading-none">
                {expandedData ? `${expandedData.activeThisWeek}/${expandedData.rosterSize}` : "—"}
              </p>
              <p className="font-body text-[10px] text-steel uppercase mt-1">
                Active this week{expandedData ? ` (${expandedData.activePct}%)` : ""}
              </p>
            </div>
          </>
        )}
      </div>
      <Link
        href={`/groups/${groupId}/business`}
        className="block text-center font-body text-xs text-rust border border-rust/40 py-2 hover:bg-rust/5 transition-colors"
      >
        Go deeper →
      </Link>
    </div>
  );
}
