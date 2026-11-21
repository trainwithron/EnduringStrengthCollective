import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { LoadFailedPage } from "@/components/ui/load-failed-page";
import { NoAccess } from "@/components/shared/no-access";
import { isReadFailure } from "@/lib/read-failed";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { RecapPicture } from "@/components/athlete/progress/recap-picture";
import { RECAP_MIN_WORKOUTS, recapYearFor, yearRecap, type RecapLog } from "@/lib/year-recap";
import { buildRecapCardModel, liftsOfYear, topLiftOfYear, type RecapRollupRow } from "@/lib/year-recap-card";
import { dateKeyInZone } from "@/lib/progress-periods";
import { DEFAULT_COACH_TIMEZONE } from "@/lib/timezone";
import { isValidTimeZone } from "@/lib/format-in-timezone";
import { loadLiftUnit } from "@/lib/lift-unit-server";

export const metadata = { title: "My year" };

// The December recap (wave 2, P7; Ron approved the Recap mockup Nov 20): the client's own year as a private picture, free, offered Dec 1 to Jan 15, with at least
// 10 workouts in the year. Always the REAL signed-in client, never a coach standing in for them through View as client (the same rule as the private photo
// journal, app/(coach)/groups/[groupId]/progress-photos/page.tsx): the picture is theirs and leaves the phone only when they tap Share or Save.
export default async function RecapPage(props: { params: Promise<{ groupId: string }> }) {
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: membership, error: membershipError }, { data: me }] = await Promise.all([
    supabase.from("group_memberships").select("role").eq("group_id", params.groupId).eq("profile_id", user.id).maybeSingle(),
    supabase.from("profiles").select("full_name, timezone").eq("id", user.id).maybeSingle(),
  ]);
  if (isReadFailure(membershipError)) return <LoadFailedPage />;
  if (!membership) return <NoAccess>This group isn&apos;t available, or you don&apos;t have access to it.</NoAccess>;
  if (membership.role !== "athlete") {
    return <NoAccess homeHref={`/groups/${params.groupId}`}>The year recap is the client&rsquo;s own. Only they can open it.</NoAccess>;
  }

  const timeZone = isValidTimeZone((me as { timezone?: string | null } | null)?.timezone) ? ((me as { timezone: string }).timezone) : DEFAULT_COACH_TIMEZONE;
  const todayKey = dateKeyInZone(new Date().toISOString(), timeZone);
  const year = recapYearFor(todayKey);
  const back = `/groups/${params.groupId}/progress`;

  let body: React.ReactNode;
  if (year == null) {
    body = (
      <p className="font-body text-sm text-steel bg-surface rounded-card p-4">
        Your year recap comes back on December 1 and stays until January 15. It&rsquo;s free, and it&rsquo;s yours to keep or share.
      </p>
    );
  } else {
    const dateKeyOf = (iso: string) => dateKeyInZone(iso, timeZone);
    const [logsRes, rollupRes, coachRes, groupRes, unit] = await Promise.all([
      supabase
        .from("workout_logs")
        .select("created_at, total_volume, total_sets_completed, total_duration_seconds, new_prs")
        .eq("athlete_id", user.id)
        .eq("group_id", params.groupId)
        .gte("created_at", `${year - 1}-12-31T00:00:00Z`)
        .lt("created_at", `${year + 1}-01-02T00:00:00Z`)
        .order("created_at", { ascending: true })
        .limit(3000),
      supabase.rpc("client_exercise_rollup", { p_athlete: user.id, p_group: params.groupId }),
      supabase.from("group_memberships").select("profiles ( full_name )").eq("group_id", params.groupId).eq("role", "coach").limit(1).maybeSingle(),
      supabase.from("groups").select("organization_id").eq("id", params.groupId).maybeSingle(),
      loadLiftUnit(supabase, user.id),
    ]);
    if (isReadFailure(logsRes.error)) return <LoadFailedPage />;

    const logs: RecapLog[] = ((logsRes.data ?? []) as any[]).map((l) => ({
      createdAt: String(l.created_at),
      totalVolume: l.total_volume == null ? null : Number(l.total_volume),
      totalSets: l.total_sets_completed ?? null,
      durationSeconds: l.total_duration_seconds ?? null,
      newPrs: (l.new_prs as string[] | null) ?? [],
    }));
    // The lifts: the same counted sets the coach's Progress cards read (a failed read just leaves the top lift off).
    const rollup: RecapRollupRow[] = rollupRes.error
      ? []
      : ((rollupRes.data ?? []) as any[]).map((r) => ({ at: String(r.at), exerciseName: String(r.exercise_name), bestWeight: r.best_weight == null ? null : Number(r.best_weight) }));
    const recap = yearRecap(year, logs, liftsOfYear(rollup, year, dateKeyOf), dateKeyOf);

    if (!recap) {
      const done = logs.filter((l) => dateKeyOf(l.createdAt).startsWith(`${year}-`)).length;
      const more = RECAP_MIN_WORKOUTS - done;
      body = (
        <p className="font-body text-sm text-steel bg-surface rounded-card p-4">
          Your {year} recap shows up once you&rsquo;ve logged {RECAP_MIN_WORKOUTS} workouts this year. You&rsquo;ve done {done}, so {more} more and it&rsquo;s ready.
        </p>
      );
    } else {
      let orgName: string | null = null;
      const orgId = (groupRes.data as { organization_id?: string | null } | null)?.organization_id ?? null;
      if (orgId) {
        const { data: org } = await supabase.from("organizations").select("name, display_name").eq("id", orgId).maybeSingle();
        orgName = ((org as { display_name?: string | null; name?: string | null } | null)?.display_name || (org as { name?: string | null } | null)?.name) ?? null;
      }
      const coachProfile = (coachRes.data as { profiles?: { full_name?: string | null } | { full_name?: string | null }[] | null } | null)?.profiles;
      const coachName = Array.isArray(coachProfile) ? coachProfile[0]?.full_name ?? null : coachProfile?.full_name ?? null;
      const top = topLiftOfYear(rollup, year, dateKeyOf);
      const model = buildRecapCardModel({
        recap,
        clientName: (me as { full_name?: string | null } | null)?.full_name ?? null,
        coachName,
        orgName,
        unit,
        topLift: top ? { name: top.name, bestWeight: top.bestWeight } : null,
        seed: `recap:${user.id}:${year}`,
      });
      body = <RecapPicture model={model} />;
    }
  }

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-24">
      <header className="px-4 pt-4 pb-2 flex items-center gap-3">
        <Link href={back} aria-label="Back to My progress" className="w-11 h-11 shrink-0 rounded-full bg-surface text-chalk inline-flex items-center justify-center">
          <span aria-hidden="true">&lsaquo;</span>
        </Link>
        <h1 className="font-display font-semibold text-[22px] leading-tight">{year != null ? `My ${year}` : "My year"}</h1>
      </header>
      <section className="px-5 pt-3">{body}</section>
      <BottomTabBar groupId={params.groupId} />
    </main>
  );
}
