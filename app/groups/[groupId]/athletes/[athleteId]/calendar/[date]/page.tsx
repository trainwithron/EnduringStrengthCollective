import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { AssignWorkoutForm, type WorkoutOption } from "@/components/coach/desktop/assign-workout-form";
import { DailyMacrosForm } from "@/components/coach/desktop/daily-macros-form";
import { DayHabitsPanel } from "@/components/coach/desktop/day-habits-panel";
import type { DueHabit } from "@/components/coach/desktop/habit-day-checklist";
import { computeScheduledDates } from "@/lib/program-schedule";
import { isHabitDueOn } from "@/lib/habits";

export default async function ClientCalendarDayPage(
  props: {
    params: Promise<{ groupId: string; athleteId: string; date: string }>;
  }
) {
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", params.groupId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (membership?.role !== "coach") {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">
          Only coaches can view a client&apos;s calendar.
        </p>
      </main>
    );
  }

  const { data: athleteMembership } = await supabase
    .from("group_memberships")
    .select("profiles ( full_name ), client_tier")
    .eq("group_id", params.groupId)
    .eq("profile_id", params.athleteId)
    .maybeSingle();

  if (!athleteMembership) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">This client isn&apos;t in this group.</p>
      </main>
    );
  }

  const athleteName = (athleteMembership.profiles as any)?.full_name ?? "Client";
  // Macro programming isn't part of what a low-ticket group client pays
  // for — the feature is hidden entirely for that tier rather than shown
  // and blocked.
  const macrosEnabled = athleteMembership.client_tier !== "group";

  const { data: group } = await supabase
    .from("groups")
    .select("name")
    .eq("id", params.groupId)
    .single();

  const date = new Date(`${params.date}T00:00:00`);
  const backHref = `/groups/${params.groupId}/athletes/${params.athleteId}/calendar`;

  // Program-computed workout for this date (read-only reference — the
  // shared group program keeps working exactly as it does today).
  const { data: program } = await supabase
    .from("programs")
    .select("id, start_date, training_days")
    .eq("group_id", params.groupId)
    .eq("is_active", true)
    .maybeSingle();

  let programWorkoutTitle: string | null = null;
  if (program?.start_date && program.training_days?.length) {
    const { data: workouts } = await supabase
      .from("workouts")
      .select("id, title, week_number, day_index")
      .eq("program_id", program.id)
      .order("week_number", { ascending: true })
      .order("day_index", { ascending: true });
    if (workouts) {
      const scheduledDateByDayId = computeScheduledDates(
        program.start_date,
        program.training_days,
        workouts
      );
      for (const w of workouts) {
        const d = scheduledDateByDayId.get(w.id);
        if (d && d.toISOString().slice(0, 10) === params.date) {
          programWorkoutTitle = w.title;
          break;
        }
      }
    }
  }

  // Every workout in this group, for the "assign a specific workout"
  // dropdown — spans every program, not just the active one, so a coach
  // can pull in something from an older program too.
  const { data: allWorkouts } = await supabase
    .from("workouts")
    .select("id, title, week_number, day_index, programs ( name )")
    .eq("group_id", params.groupId)
    .order("week_number", { ascending: true })
    .order("day_index", { ascending: true });

  const workoutOptions: WorkoutOption[] = (allWorkouts ?? []).map((w: any) => ({
    id: w.id,
    label: `${w.programs?.name ?? "Program"} — Wk ${w.week_number} Day ${w.day_index + 1}: ${w.title}`,
  }));

  const { data: assignment } = await supabase
    .from("workout_assignments")
    .select("workout_id, note")
    .eq("athlete_id", params.athleteId)
    .eq("scheduled_date", params.date)
    .maybeSingle();

  const { data: macros } = await supabase
    .from("daily_macros")
    .select("calories, protein_g, carbs_g, fat_g")
    .eq("athlete_id", params.athleteId)
    .eq("log_date", params.date)
    .maybeSingle();

  const { data: latestWeightRow } = await supabase
    .from("body_weight_logs")
    .select("weight")
    .eq("athlete_id", params.athleteId)
    .order("logged_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: habitRows } = await supabase
    .from("client_habits")
    .select("id, title, weekdays")
    .eq("athlete_id", params.athleteId)
    .eq("group_id", params.groupId)
    .eq("active", true);

  const dueHabitDefs = (habitRows ?? []).filter((h) => isHabitDueOn(h.weekdays, date));

  const { data: habitLogRows } = await supabase
    .from("habit_logs")
    .select("habit_id, completed_at")
    .in("habit_id", dueHabitDefs.map((h) => h.id))
    .eq("log_date", params.date);

  const completedHabitIds = new Set(
    (habitLogRows ?? []).filter((l) => l.completed_at).map((l) => l.habit_id)
  );

  const dueHabits: DueHabit[] = dueHabitDefs.map((h) => ({
    id: h.id,
    title: h.title,
    completed: completedHabitIds.has(h.id),
  }));

  // Coach's own schedule that day — bookings across every client, plus
  // recurring availability for this weekday — so assigning something for
  // this athlete doesn't happen blind to the coach's own commitments.
  const { data: dayBookings } = await supabase
    .from("bookings")
    .select("start_at, athlete_id, profiles ( full_name )")
    .eq("coach_id", user.id)
    .eq("status", "confirmed")
    .gte("start_at", `${params.date}T00:00:00`)
    .lt("start_at", `${params.date}T23:59:59.999`)
    .order("start_at", { ascending: true });

  const { data: availabilityWindows } = await supabase
    .from("coach_availability_windows")
    .select("start_time, end_time")
    .eq("coach_id", user.id)
    .eq("weekday", date.getDay())
    .order("start_time", { ascending: true });

  const dateLabel = date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="clients">
      <Link href={backHref} className="font-body text-xs text-steel uppercase tracking-wide">
        &larr; Back to calendar
      </Link>
      <h1 className="font-display font-bold text-2xl uppercase leading-tight mt-3">
        {athleteName}
      </h1>
      <p className="font-body text-sm text-steel mb-6">{dateLabel}</p>

      <div className="grid grid-cols-3 gap-6">
        <section className="border border-steel/20 p-4">
          <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-3">
            Workout
          </h2>
          {programWorkoutTitle && (
            <p className="font-body text-xs text-steel mb-2">
              Program default: <span className="text-chalk">{programWorkoutTitle}</span>
            </p>
          )}
          <AssignWorkoutForm
            athleteId={params.athleteId}
            groupId={params.groupId}
            date={params.date}
            options={workoutOptions}
            initialWorkoutId={assignment?.workout_id ?? null}
            initialNote={assignment?.note ?? ""}
          />
        </section>

        <section className="border border-steel/20 p-4">
          <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-3">
            Daily macros
          </h2>
          {macrosEnabled ? (
            <DailyMacrosForm
              athleteId={params.athleteId}
              groupId={params.groupId}
              date={params.date}
              initial={{
                calories: macros?.calories ?? null,
                proteinG: macros?.protein_g ?? null,
                carbsG: macros?.carbs_g ?? null,
                fatG: macros?.fat_g ?? null,
              }}
              latestBodyWeight={latestWeightRow?.weight ?? null}
            />
          ) : (
            <p className="font-body text-xs text-steel">
              Not included for this client&apos;s tier (Group). Change their tier from the Clients
              page to enable macro programming.
            </p>
          )}
        </section>

        <section className="border border-steel/20 p-4">
          <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-3">
            Habits due
          </h2>
          <DayHabitsPanel
            athleteId={params.athleteId}
            groupId={params.groupId}
            date={params.date}
            dueHabits={dueHabits}
          />
        </section>
      </div>

      <section className="border border-steel/20 p-4 mt-6">
        <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-3">
          Your schedule this day
        </h2>
        {availabilityWindows && availabilityWindows.length > 0 && (
          <div className="mb-3">
            <p className="font-body text-[11px] text-steel uppercase tracking-wide mb-1">
              Recurring availability
            </p>
            <div className="flex flex-wrap gap-2">
              {availabilityWindows.map((w, i) => (
                <span key={i} className="font-body text-xs text-chalk border border-steel/30 px-2 py-1">
                  {w.start_time.slice(0, 5)}–{w.end_time.slice(0, 5)}
                </span>
              ))}
            </div>
          </div>
        )}
        {dayBookings && dayBookings.length > 0 ? (
          <div className="divide-y divide-steel/15">
            {dayBookings.map((b: any, i: number) => (
              <div key={i} className="py-2 flex items-center justify-between">
                <span className="font-body text-sm">
                  {b.profiles?.full_name ?? "A client"}
                </span>
                <span className="font-body text-xs text-steel">
                  {new Date(b.start_at).toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="font-body text-sm text-steel">No booked sessions this day.</p>
        )}
      </section>
    </CoachDesktopShell>
  );
}
