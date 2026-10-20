import { COACH_HOME_HREF } from "@/lib/start-group";
import { LoadFailedPage } from "@/components/ui/load-failed-page";
import { isReadFailure } from "@/lib/read-failed";
import Link from "next/link";
import { NoAccess } from "@/components/shared/no-access";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { isMemberOfGroup, NOT_IN_GROUP_MESSAGE } from "@/lib/athlete-in-group";
import { getActivePrograms } from "@/lib/active-programs";
import { CoachModeBar } from "@/components/coach/mobile/coach-mode-bar";
import { ProgramPlainView } from "@/components/shared/program-plain-view-server";
import { getTodaysSessions } from "@/lib/todays-workout";
import { getGroupCoachTimezone, nowInZone } from "@/lib/timezone";
import { PICK_LABEL, VIEW_PROGRAM_LABEL, buildLogChoices, exerciseCountLine, startLabel, weekdayName } from "@/lib/coach-log-choice";

export const metadata = { title: "Log" };

// Coach-only: the entry point for logging an in-person session on a client's behalf. It opens on a SMALL choice and never straight into a day: "Start [Day]'s workout" (what is due today) and
// "View whole program" (every week and day open, nothing locked for the coach), one card per program the client follows. Picking a day from the program view logs that day; Back from a day
// returns to the program view, so there is no loop and the whole program is always reachable.
export default async function LogForClientPage(
  props: {
    params: Promise<{ groupId: string; athleteId: string }>;
    searchParams: Promise<{ program?: string }>;
  }
) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: membership, error: membershipError } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", params.groupId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (isReadFailure(membershipError)) return <LoadFailedPage />;

  if (membership?.role !== "coach") {
    return (
      <NoAccess>Only coaches can log sessions for a client.</NoAccess>
    );
  }

  if (!(await isMemberOfGroup(supabase, params.groupId, params.athleteId))) {
    return <NoAccess>{NOT_IN_GROUP_MESSAGE}</NoAccess>;
  }

  const { data: athleteProfile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", params.athleteId)
    .single();
  const clientName = athleteProfile?.full_name ?? "this client";
  const logBase = `/groups/${params.groupId}/athletes/${params.athleteId}/log`;

  // The programs this client follows (their own and the shared ones), never another client's personal program or the coach's hidden template.
  const programs = await getActivePrograms(supabase, params.groupId, params.athleteId);

  if (programs.length === 0) {
    return (
      <main className="min-h-screen bg-graphite text-chalk font-body pb-24">
        <CoachModeBar groupId={params.groupId} clientName={clientName} homeHref={COACH_HOME_HREF} />
        <header className="px-5 pt-4 pb-4 border-b border-steel/20">
          <Link href={`/groups/${params.groupId}/athletes/${params.athleteId}`} className="font-body text-xs text-steel uppercase tracking-wide">
            &larr; Back to profile
          </Link>
          <h1 className="font-display font-bold text-3xl leading-tight mt-3 uppercase">No active program yet</h1>
        </header>
        <section className="px-5 pt-6">
          <p className="font-body text-sm text-steel mb-4">
            This group doesn&apos;t have an active program yet — assign one from {clientName}&apos;s profile before logging an in-person session.
          </p>
          <Link
            href={`/groups/${params.groupId}/athletes/${params.athleteId}`}
            className="inline-block h-11 px-5 leading-[2.75rem] bg-rust text-graphite font-body font-bold text-sm text-center"
          >
            Go to profile &rarr;
          </Link>
        </section>
      </main>
    );
  }

  // The whole program: every week and day open, with "Log this workout" on each day.
  const chosen = searchParams.program ? programs.find((p) => p.id === searchParams.program) : undefined;
  if (chosen) {
    return (
      <>
        <CoachModeBar groupId={params.groupId} clientName={clientName} homeHref={COACH_HOME_HREF} />
        <ProgramPlainView
          groupId={params.groupId}
          programId={chosen.id}
          userId={user.id}
          isCoach
          subjectId={params.athleteId}
          backHref={logBase}
          workoutHrefBase={logBase}
          startLabel="Log this workout"
          program={{ name: chosen.name, start_date: chosen.startDate, training_days: chosen.trainingDays, visibility_window: chosen.visibilityWindow, athlete_id: chosen.athleteId }}
        />
      </>
    );
  }

  const todaySessions = await getTodaysSessions(supabase, { groupId: params.groupId, athleteId: params.athleteId });
  const workoutIds = todaySessions.cards.map((c) => c.workoutId);
  const { data: countRows } = workoutIds.length
    ? await supabase.from("workouts").select("id, group_workout_exercises(count)").in("id", workoutIds)
    : { data: [] as any[] };
  const exerciseCountByWorkout: Record<string, number> = {};
  for (const r of (countRows ?? []) as any[]) exerciseCountByWorkout[r.id] = r.group_workout_exercises?.[0]?.count ?? 0;
  const choices = buildLogChoices(
    programs.map((p) => ({ programId: p.id, name: p.name, label: p.label })),
    todaySessions.cards,
    exerciseCountByWorkout
  );
  const timezone = await getGroupCoachTimezone(supabase, params.groupId);
  const weekday = weekdayName(nowInZone(timezone), timezone);

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-24">
      <CoachModeBar groupId={params.groupId} clientName={clientName} homeHref={COACH_HOME_HREF} />
      <header className="px-5 pt-2 pb-1">
        <Link href={`/groups/${params.groupId}/athletes/${params.athleteId}`} className="font-body text-xs text-steel uppercase tracking-wide min-h-11 inline-flex items-center">
          &larr; Back to profile
        </Link>
      </header>
      <ul className="px-5 pt-2 space-y-3">
        {choices.map((c) => (
          <li key={c.programId} className="border border-steel/20 bg-surface/40 p-4" data-testid="log-choice">
            <p className="font-body text-xs text-rust uppercase tracking-wide">{c.heading}</p>
            {c.kind === "start" && (
              <>
                <Link
                  href={`${logBase}/${c.workoutId}`}
                  className="mt-2 w-full min-h-14 flex items-center justify-center bg-rust text-graphite font-display uppercase text-lg font-bold text-center px-3"
                >
                  {startLabel(weekday)}
                </Link>
                <p className="font-body text-xs text-steel mt-2">
                  {c.title} &middot; {exerciseCountLine(c.exerciseCount)}
                </p>
              </>
            )}
            {c.kind === "done" && (
              <p className="font-body text-sm text-chalk mt-2">
                Today&apos;s workout is logged{c.title ? `: ${c.title}` : ""}.
              </p>
            )}
            {c.kind === "pick" ? (
              <Link
                href={`${logBase}?program=${c.programId}`}
                className="mt-2 w-full min-h-14 flex items-center justify-center bg-rust text-graphite font-display uppercase text-lg font-bold text-center px-3"
              >
                {PICK_LABEL}
              </Link>
            ) : (
              <Link
                href={`${logBase}?program=${c.programId}`}
                className="mt-3 w-full min-h-11 flex items-center justify-center border border-steel/40 text-chalk font-body text-sm text-center px-3"
              >
                {VIEW_PROGRAM_LABEL}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
