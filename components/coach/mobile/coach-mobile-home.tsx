import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { getTodaysDueRoster } from "@/lib/todays-due-roster";
import { computeRealIncomeInRange, computeRealMRR } from "@/lib/business-metrics";
import { dateKeyInZone, getGroupCoachTimezone } from "@/lib/timezone";
import { ViewAsClientEntryPoint } from "@/components/athlete/view-as-client-entry-point";
import { ViewModeToggle } from "@/components/coach/view-mode-toggle";
import { CoachHomeComplications } from "./coach-home-complications";
import { CoachMobileShell } from "./coach-mobile-shell";

// The coach mobile Home (coach_mobile_app_redesign_plan.md, locked
// 2026-09-14) — replaces the old pattern of a coach on mobile seeing
// their own athlete-style Day/Week/Month view with a roster list
// appended below it. Real job, per Ron's own framing: "primarily for
// in-person logging and minor changes." Leads with "Log a session"
// (who's due today), not a dashboard.
export async function CoachMobileHome({ groupId, groupName }: { groupId: string; groupName: string }) {
  const supabase = await createServerClient();
  const timezone = await getGroupCoachTimezone(supabase, groupId);
  const todayKey = dateKeyInZone(timezone);
  const weekAgoKey = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [dueRoster, { data: purchaseRows }, { data: subRows }] = await Promise.all([
    getTodaysDueRoster(supabase, { groupId }),
    supabase.from("credit_purchases").select("amount_cents, created_at").eq("group_id", groupId),
    supabase.from("membership_subscriptions").select("price_cents, status").eq("group_id", groupId),
  ]);

  const incomeEvents = (purchaseRows ?? []).map((p) => ({
    amountCents: p.amount_cents,
    createdAtDateKey: new Date(p.created_at).toISOString().slice(0, 10),
  }));
  const revenueToday = computeRealIncomeInRange(incomeEvents, todayKey, todayKey);
  const revenueWeek = computeRealIncomeInRange(incomeEvents, weekAgoKey, todayKey);
  const mrr = computeRealMRR(
    (subRows ?? []).map((s) => ({
      priceCents: s.price_cents,
      status: s.status as "active" | "past_due" | "canceled" | "incomplete",
    }))
  );

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body">
      <CoachMobileShell groupId={groupId} groupName={groupName}>
        <header className="px-5 pt-8 pb-4">
          <h1 className="font-display font-bold text-3xl leading-none uppercase truncate">{groupName}</h1>
        </header>

        <div className="px-5 pb-5 flex items-center gap-2">
          <ViewAsClientEntryPoint />
          <ViewModeToggle targetMode="desktop" label="Desktop Mode" variant="button" groupId={groupId} />
        </div>

        <section className="px-5">
          <CoachHomeComplications
            groupId={groupId}
            revenueToday={revenueToday}
            revenueWeek={revenueWeek}
            mrr={mrr}
            dueRoster={dueRoster}
          />
        </section>

        <section className="px-5 pt-6 pb-8">
          <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">Log a session</h2>
          {dueRoster.length === 0 ? (
            <p className="font-body text-sm text-steel border border-steel/20 p-4">
              No clients due today.
            </p>
          ) : (
            <div className="space-y-2">
              {dueRoster.map((entry) => (
                <Link
                  key={entry.athleteId}
                  href={`/groups/${groupId}/athletes/${entry.athleteId}/log/${entry.workoutId}`}
                  className="flex items-center justify-between gap-2 border border-steel/20 p-3 active:border-rust"
                >
                  <div className="min-w-0">
                    <p className="font-body text-sm text-chalk truncate">{entry.fullName}</p>
                    <p className="font-body text-xs text-steel truncate">{entry.workoutTitle ?? "Workout"}</p>
                  </div>
                  <span className="font-body text-xs text-rust shrink-0">Log →</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </CoachMobileShell>
    </main>
  );
}
