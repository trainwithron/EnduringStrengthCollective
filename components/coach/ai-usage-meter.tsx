"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AI_ACTION_COSTS, type AiUsageSummary } from "@/lib/coach-credits";

type Focus = "both" | "program" | "mealplan";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function formatReset(dateKey: string): string {
  const [, m, d] = dateKey.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

// Plain-language, no alarm: AI generations are included in the plan, up
// to a generous monthly amount that scales with client count. A gentle
// heads-up at 80%; past the limit a friendly line pointing at the
// existing credits path instead of a wall. Hidden for unlimited
// (internal) accounts and for anyone the usage route can't resolve.
export function AiUsageMeter({
  groupId,
  focus = "both",
  compact = false,
  refreshKey,
}: {
  groupId: string;
  focus?: Focus;
  compact?: boolean;
  refreshKey?: string | number | null;
}) {
  const [usage, setUsage] = useState<AiUsageSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/ai/usage")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) setUsage(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (!usage || usage.unlimited) return null;

  const showProgram = focus !== "mealplan";
  const showMeal = focus !== "program";
  const rows = [
    showProgram && { key: "program", label: "program generations", ...usage.program, cost: AI_ACTION_COSTS.program_generation },
    showMeal && { key: "mealplan", label: "meal plans", ...usage.mealplan, cost: AI_ACTION_COSTS.nutrition_plan },
  ].filter(Boolean) as { key: string; label: string; used: number; limit: number; cost: number }[];

  const atLimit = rows.some((r) => r.used >= r.limit);
  const nearLimit = !atLimit && rows.some((r) => r.used >= r.limit * 0.8);
  const summary = rows.map((r) => `${r.used} of ${r.limit} ${r.label}`).join(" · ");
  const creditsHref = `/groups/${groupId}/branding?tab=credits`;

  const message = atLimit
    ? `You've used this month's included ${rows.filter((r) => r.used >= r.limit).map((r) => r.label).join(" and ")}. Extra ones are ${rows[0].cost} credits each — you have ${usage.balance}.`
    : nearLimit
      ? "You've used most of this month's included generations."
      : null;

  if (compact) {
    return (
      <p className="font-body text-[11px] text-steel">
        Included in your plan: {summary} this month.{message ? ` ${message}` : ""}{" "}
        {(atLimit || nearLimit) && (
          <Link href={creditsHref} className="text-rust underline underline-offset-2">
            {atLimit ? "Buy credits" : "See usage"}
          </Link>
        )}
      </p>
    );
  }

  return (
    <div className="border border-steel/20 p-4 mb-4">
      <p className="font-body text-[11px] text-steel uppercase tracking-wide mb-1">Included in your plan this month</p>
      <p className="font-body text-sm text-chalk">{summary}</p>
      <p className="font-body text-xs text-steel mt-1">
        Resets {formatReset(usage.resetsOn)}. Your included amount grows with your client count ({usage.clients}{" "}
        client{usage.clients === 1 ? "" : "s"} right now).
      </p>
      {message && (
        <p className={`font-body text-xs mt-2 ${atLimit ? "text-rust" : "text-steel"}`}>
          {message}
          {atLimit && " Buy credits below to keep going."}
        </p>
      )}
    </div>
  );
}
