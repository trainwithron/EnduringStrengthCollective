"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";
import {
  computeRealIncomeThisMonth,
  computeRealMRR,
  computeActivePayingClients,
} from "@/lib/business-metrics";

interface MiniBusinessData {
  incomeThisMonth: number;
  mrr: number;
  payingClients: number;
}

// The "pin a real Business mini-dashboard in place of the roster"
// picture-in-picture panel (coach_desktop_shell_identity_redesign.md,
// item 2) — real numbers via the same pure lib/business-metrics.ts
// functions the full Business page uses, at a scope this coach can
// glance at without leaving whatever page they're actually on. "Go
// deeper" links to the full page for the real charts/roster-level
// detail this compact view deliberately doesn't try to replicate.
export function BusinessMiniDashboard({ groupId }: { groupId: string }) {
  const [data, setData] = useState<MiniBusinessData | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const monthKey = new Date().toISOString().slice(0, 7);

      const [{ data: purchaseRows }, { data: subRows }, { data: memberRows }] = await Promise.all([
        supabase
          .from("credit_purchases")
          .select("amount_cents, created_at, athlete_id")
          .eq("group_id", groupId),
        supabase
          .from("membership_subscriptions")
          .select("price_cents, status, athlete_id")
          .eq("group_id", groupId),
        supabase.from("group_memberships").select("profile_id").eq("group_id", groupId).eq("role", "athlete"),
      ]);

      const incomeThisMonth = computeRealIncomeThisMonth(
        (purchaseRows ?? []).map((r: any) => ({
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
  }, [groupId]);

  return (
    <div className="space-y-3">
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
