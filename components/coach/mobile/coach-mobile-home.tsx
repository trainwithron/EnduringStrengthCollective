import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { getTodaysDueRoster } from "@/lib/todays-due-roster";
import { getTodaysWorkoutId } from "@/lib/todays-workout";
import { computeRealIncomeInRange, computeRealMRR } from "@/lib/business-metrics";
import { dateKeyInZone, getGroupCoachTimezone } from "@/lib/timezone";
import { ViewAsClientEntryPoint } from "@/components/athlete/view-as-client-entry-point";
import { ViewModeToggle } from "@/components/coach/view-mode-toggle";
import { TodayWidget, type TodayMacros } from "@/components/athlete/today-widget";
import { CoachHomeComplications } from "./coach-home-complications";
import { CoachMobileShell } from "./coach-mobile-shell";
import { getNeedsAttentionItems } from "@/lib/needs-attention-data";

// The coach mobile Home (coach_mobile_app_redesign_plan.md, locked
// 2026-09-14) — replaces the old pattern of a coach on mobile seeing
// their own athlete-style Day/Week/Month view with a roster list
// appended below it. Real job, per Ron's own framing: "primarily for
// in-person logging and minor changes." Leads with "Log a session"
// (who's due today), not a dashboard.
export async function CoachMobileHome({
  groupId,
  groupName,
  coachId,
}: {
  groupId: string;
  groupName: string;
  coachId: string;
}) {
  const supabase = await createServerClient();
  const timezone = await getGroupCoachTimezone(supabase, groupId);
  const todayKey = dateKeyInZone(timezone);
  const weekAgoKey = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [dueRoster, { data: purchaseRows }, { data: subRows }, { data: rosterRows }, needsAttentionItems] =
    await Promise.all([
      getTodaysDueRoster(supabase, { groupId }),
      supabase.from("credit_purchases").select("amount_cents, created_at").eq("group_id", groupId),
      supabase.from("membership_subscriptions").select("price_cents, status").eq("group_id", groupId),
      supabase.from("group_memberships").select("profile_id, profiles ( full_name )").eq("group_id", groupId).eq("role", "athlete"),
      getNeedsAttentionItems(supabase, { coachId, groupIds: [groupId] }),
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
      status: s.status as "active" | "past_due" | "canceled" | "incomplete" | "paused",
    }))
  );

  const topDue = dueRoster[0] ?? null;
  const soloAthlete =
    !topDue && (rosterRows ?? []).length === 1 ? (rosterRows as any[])[0] : null;

  // Nothing due today, but this is a 1-on-1 group (the overwhelmingly
  // common real case here — every 1-on-1 client already lives in their
  // own dedicated group) — resolve that one client's real next workout
  // and today's macro target instead of a flat "nothing due" message.
  // Ron's own words: "some people don't necessarily stick to the
  // calendar day," so this always resolves the real next workout, never
  // a hardcoded "tomorrow."
  let soloNextWorkoutTitle: string | null = null;
  let soloNextWorkoutId: string | null = null;
  let soloStatus: "locked" | "done" | "no-program" | null = null;
  let soloUnlocksOn: Date | null = null;
  let soloMacros: TodayMacros | null = null;

  if (soloAthlete) {
    const athleteId = soloAthlete.profile_id as string;
    const [result, { data: macroRow }] = await Promise.all([
      getTodaysWorkoutId(supabase, { groupId, athleteId }),
      supabase
        .from("daily_macros")
        .select("calories, protein_g, carbs_g, fat_g")
        .eq("athlete_id", athleteId)
        .eq("log_date", todayKey)
        .maybeSingle(),
    ]);

    soloStatus = result.status === "ready" ? null : result.status;
    if (result.status === "locked") {
      soloUnlocksOn = result.unlocksOn;
      soloNextWorkoutId = result.workoutId;
    }
    if (soloMacros === null && macroRow) {
      soloMacros = {
        calories: macroRow.calories,
        proteinG: macroRow.protein_g,
        carbsG: macroRow.carbs_g,
        fatG: macroRow.fat_g,
      };
    }

    if (soloNextWorkoutId) {
      const { data: workoutRow } = await supabase
        .from("workouts")
        .select("title")
        .eq("id", soloNextWorkoutId)
        .maybeSingle();
      soloNextWorkoutTitle = workoutRow?.title ?? null;
    }
  }

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body">
      <CoachMobileShell groupId={groupId} groupName={groupName}>
        {/* pt-16 (not the usual pt-8) — the fixed Spot trigger button
            (top-3, h-10, centered) sits on top of every mobile page; a
            long/full-width group name here (unlike "Calendar"/
            "Messages"/"Clients" elsewhere) reaches the button's
            horizontal position, so this header needs real vertical
            clearance to not render underneath it. */}
        <header className="px-5 pt-16 pb-4">
          <h1 className="font-display font-bold text-3xl leading-none uppercase truncate">{groupName}</h1>
        </header>

        <div className="px-5 pb-5 flex items-center gap-2">
          <ViewAsClientEntryPoint />
          <ViewModeToggle targetMode="desktop" label="Desktop Mode" variant="button" groupId={groupId} />
        </div>

        {/* Priority 1: a workout is due right now — the single most
            prominent thing on Home, ahead of the complications row and
            everything else. This is almost always logging someone
            else's in-person session for Ron. */}
        {topDue && (
          <section className="px-5 pb-6">
            <Link
              href={`/groups/${groupId}/athletes/${topDue.athleteId}/log/${topDue.workoutId}`}
              className="block border border-rust bg-rust/10 p-5 active:bg-rust/15 transition-colors"
            >
              <p className="font-body text-[10px] text-rust uppercase tracking-wide font-bold">
                Due today
              </p>
              <p className="font-display font-bold text-2xl leading-tight mt-1 truncate">
                {topDue.fullName}
              </p>
              <p className="font-body text-sm text-steel mt-0.5 truncate">
                {topDue.workoutTitle ?? "Workout"}
              </p>
              <span className="inline-block mt-4 h-11 px-5 leading-[2.75rem] bg-rust text-graphite font-body font-bold text-sm">
                Start Workout &rarr;
              </span>
            </Link>

            {dueRoster.length > 1 && (
              <div className="mt-2 space-y-2">
                {dueRoster.slice(1).map((entry) => (
                  <Link
                    key={entry.athleteId}
                    href={`/groups/${groupId}/athletes/${entry.athleteId}/log/${entry.workoutId}`}
                    className="flex items-center justify-between gap-2 border border-steel/20 p-3 active:border-rust"
                  >
                    <div className="min-w-0">
                      <p className="font-body text-sm text-chalk truncate">{entry.fullName}</p>
                      <p className="font-body text-xs text-steel truncate">{entry.workoutTitle ?? "Workout"}</p>
                    </div>
                    <span className="font-body text-xs text-rust shrink-0">Log &rarr;</span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Priority 2: nothing due today. For a 1-on-1 group, show real
            signal for that one client instead of an empty state. */}
        {!topDue && soloAthlete && (
          <section className="px-5 pb-6 space-y-3">
            {soloMacros && (
              <TodayWidget todayDate={todayKey} macros={soloMacros} habits={[]} />
            )}
            <div className="border border-steel/20 p-4">
              <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
                Nothing due today
              </h2>
              {soloStatus === "locked" && (
                <>
                  <p className="font-body text-sm text-chalk">
                    {soloNextWorkoutTitle ?? "Next workout"}
                  </p>
                  <p className="font-body text-xs text-steel mt-1">
                    Unlocks{" "}
                    {soloUnlocksOn?.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                  </p>
                </>
              )}
              {soloStatus === "done" && (
                <p className="font-body text-sm text-steel">
                  {soloAthlete.profiles?.full_name ?? "This client"} is caught up — everything
                  scheduled is already logged.
                </p>
              )}
              {soloStatus === "no-program" && (
                <p className="font-body text-sm text-steel">No program assigned yet.</p>
              )}
              <Link
                href={`/groups/${groupId}/athletes/${soloAthlete.profile_id}`}
                className="inline-block mt-3 font-body text-xs text-rust uppercase tracking-wide"
              >
                Go to profile &rarr;
              </Link>
            </div>
          </section>
        )}

        {!topDue && !soloAthlete && (
          <section className="px-5 pb-6">
            <p className="font-body text-sm text-steel border border-steel/20 p-4">
              No clients due today.
            </p>
          </section>
        )}

        <section className="px-5 pb-8">
          <CoachHomeComplications
            groupId={groupId}
            coachId={coachId}
            revenueToday={revenueToday}
            revenueWeek={revenueWeek}
            mrr={mrr}
            activeClientCount={(rosterRows ?? []).length}
            needsAttentionItems={needsAttentionItems}
          />
        </section>
      </CoachMobileShell>
    </main>
  );
}
