"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import {
  computeRealIncomeThisMonth,
  computeRealMRR,
  computeActivePayingClients,
  computeEngagement,
  computeMonthlyGrowth,
  computeEstimatedMRR,
} from "@/lib/business-metrics";
import { buildSparklinePath } from "@/lib/program-card-visuals";
import {
  resolveTopBusinessMetrics,
  BUSINESS_METRIC_LABELS,
  ALL_BUSINESS_METRIC_KEYS,
  type BusinessMetricKey,
} from "@/lib/business-rail-metrics";
import { RailWidgetHeader, RailWidgetDeeperLink, RailWidgetLoading } from "./rail-widget-shell";

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatMetricValue(key: BusinessMetricKey, value: number): string {
  switch (key) {
    case "mrr":
    case "income_month":
      return `$${Math.round(value).toLocaleString()}`;
    case "engagement_pct":
      return `${Math.round(value)}%`;
    default:
      return String(Math.round(value));
  }
}

// Hover rail widgets (hover_expand_rail_widgets_idea.md) — Business icon.
// The coach's own top-3 picked metrics, reusing the exact pure functions
// (and the same coach-wide, every-group-they-coach scope) the real
// Business dashboard already computes with — no separate math for this
// popover. The one real chart in this build: a 6-month new-clients
// sparkline via lib/program-card-visuals.ts's buildSparklinePath, since
// that's the only one of these six candidate metrics with genuine
// multi-point history — MRR/active-clients/income are current snapshots,
// and this app never fabricates a trend where none exists.
export function BusinessRailWidget({ groupId }: { groupId: string }) {
  const [values, setValues] = useState<Record<BusinessMetricKey, number> | null>(null);
  const [growthSeries, setGrowthSeries] = useState<number[] | null>(null);
  const [picked, setPicked] = useState<BusinessMetricKey[]>([]);
  const [customizing, setCustomizing] = useState(false);
  const [draft, setDraft] = useState<BusinessMetricKey[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const [{ data: layoutRow }, { data: coachedGroups }] = await Promise.all([
        supabase.from("coach_dashboard_layout").select("business_widget_metrics").eq("coach_id", user.id).maybeSingle(),
        supabase.from("group_memberships").select("group_id").eq("profile_id", user.id).eq("role", "coach"),
      ]);
      const groupIds = (coachedGroups ?? []).map((g) => g.group_id);
      const safeGroupIds = groupIds.length > 0 ? groupIds : ["00000000-0000-0000-0000-000000000000"];
      const resolvedPicks = resolveTopBusinessMetrics(layoutRow?.business_widget_metrics ?? []);

      const [{ data: memberRows }, { data: logRows }, { data: purchaseRows }, { data: subRows }] = await Promise.all([
        supabase
          .from("group_memberships")
          .select("profile_id, joined_at, monthly_rate")
          .in("group_id", safeGroupIds)
          .eq("role", "athlete"),
        supabase.from("workout_logs").select("athlete_id, created_at").in("group_id", safeGroupIds),
        supabase.from("credit_purchases").select("athlete_id, amount_cents, created_at").in("group_id", safeGroupIds),
        supabase.from("membership_subscriptions").select("athlete_id, price_cents, status").in("group_id", safeGroupIds),
      ]);

      const today = new Date();
      const todayKey = dateKey(today);
      const monthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
      const uniqueAthleteIds = new Set((memberRows ?? []).map((m) => m.profile_id));

      const lastActiveByAthlete = new Map<string, string>();
      for (const log of logRows ?? []) {
        const key = dateKey(new Date(log.created_at));
        const existing = lastActiveByAthlete.get(log.athlete_id);
        if (!existing || key > existing) lastActiveByAthlete.set(log.athlete_id, key);
      }

      const realMRR = computeRealMRR(
        (subRows ?? []).map((s) => ({
          priceCents: s.price_cents,
          status: s.status as "active" | "past_due" | "canceled" | "incomplete" | "paused",
        }))
      );
      const estimatedMRR = computeEstimatedMRR((memberRows ?? []).map((m) => ({ monthlyRate: m.monthly_rate })));
      const athleteIdsWithPurchase = new Set((purchaseRows ?? []).map((p) => p.athlete_id));
      const athleteIdsWithActiveSub = new Set(
        (subRows ?? []).filter((s) => s.status === "active").map((s) => s.athlete_id)
      );
      const activePaying = computeActivePayingClients(
        [...uniqueAthleteIds].map((athleteId) => ({
          athleteId,
          hasActivePurchaseOrSub: athleteIdsWithActiveSub.has(athleteId) || athleteIdsWithPurchase.has(athleteId),
        }))
      );
      const incomeMonth = computeRealIncomeThisMonth(
        (purchaseRows ?? []).map((p) => ({ amountCents: p.amount_cents, createdAtDateKey: dateKey(new Date(p.created_at)) })),
        monthKey
      );
      const engagement = computeEngagement(
        [...uniqueAthleteIds].map((id) => ({ lastActiveDateKey: lastActiveByAthlete.get(id) ?? null })),
        todayKey,
        14
      );
      const growth = computeMonthlyGrowth(
        (memberRows ?? []).map((m) => dateKey(new Date(m.joined_at))),
        todayKey,
        6
      );

      if (!cancelled) {
        setValues({
          mrr: realMRR > 0 ? realMRR : estimatedMRR,
          new_clients_month: growth[growth.length - 1]?.count ?? 0,
          active_paying: activePaying,
          income_month: incomeMonth,
          roster_size: uniqueAthleteIds.size,
          engagement_pct: engagement.pct,
        });
        setGrowthSeries(growth.map((g) => g.count));
        setPicked(resolvedPicks);
        setDraft(resolvedPicks);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  async function handleSaveCustomize() {
    setSaving(true);
    try {
      await fetch("/api/coach/dashboard-layout", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessWidgetMetrics: draft }),
      });
      setPicked(draft);
      setCustomizing(false);
    } finally {
      setSaving(false);
    }
  }

  if (values === null || growthSeries === null) {
    return (
      <div>
        <RailWidgetHeader title="Your top 3" />
        <RailWidgetLoading />
      </div>
    );
  }

  const spark = buildSparklinePath(growthSeries, 220, 40);

  if (customizing) {
    return (
      <div>
        <RailWidgetHeader title="Pick your top 3" />
        <div className="space-y-2">
          {[0, 1, 2].map((slot) => (
            <select
              key={slot}
              value={draft[slot] ?? ""}
              onChange={(e) => {
                const next = [...draft];
                next[slot] = e.target.value as BusinessMetricKey;
                setDraft(next);
              }}
              className="w-full h-8 bg-graphite border border-steel/30 text-chalk font-body text-xs px-1.5"
            >
              {ALL_BUSINESS_METRIC_KEYS.map((key) => (
                <option key={key} value={key}>
                  {BUSINESS_METRIC_LABELS[key]}
                </option>
              ))}
            </select>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-2.5">
          <button
            type="button"
            onClick={handleSaveCustomize}
            disabled={saving}
            className="h-7 px-2.5 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(picked);
              setCustomizing(false);
            }}
            className="font-body text-xs text-steel"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <RailWidgetHeader title="Your top 3" />
        <button
          type="button"
          onClick={() => setCustomizing(true)}
          className="font-body text-[10px] text-steel underline underline-offset-2 -mt-2"
        >
          Customize
        </button>
      </div>

      <svg viewBox="0 0 220 40" className="w-full h-10 mb-2.5" preserveAspectRatio="none">
        {spark.areaPath && <path d={spark.areaPath} fill="rgb(var(--rust) / 0.1)" stroke="none" />}
        <path d={spark.linePath} fill="none" stroke="rgb(var(--rust))" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {spark.points.map(
          (p, i) =>
            p &&
            i === spark.points.length - 1 && (
              <circle key={i} cx={p.x} cy={p.y} r={3} fill="rgb(var(--rust))" stroke="#262422" strokeWidth={2} />
            )
        )}
      </svg>
      <p className="font-body text-[10px] text-steel uppercase tracking-wide -mt-1.5 mb-2">New clients, 6mo</p>

      <div>
        {picked.map((key) => (
          <div key={key} className="flex items-center justify-between py-1 border-b border-steel/10 last:border-b-0">
            <span className="font-body text-xs text-steel">{BUSINESS_METRIC_LABELS[key]}</span>
            <span className="font-body text-sm text-chalk font-medium">{formatMetricValue(key, values[key])}</span>
          </div>
        ))}
      </div>
      <RailWidgetDeeperLink href={`/groups/${groupId}/business`} label="Open Business" />
    </div>
  );
}
