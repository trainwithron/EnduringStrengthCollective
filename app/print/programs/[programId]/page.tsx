import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { NoAccess } from "@/components/shared/no-access";
import { PrintButton } from "@/components/shared/print-button";
import { SET_ROW_SELECT, mapSetRow } from "@/lib/exercise-fields";
import { computeScheduledDates, formatShortDate, isLocked } from "@/lib/program-schedule";
import { getGroupCoachTimezone, nowInZone } from "@/lib/timezone";
import { getViewerDisplayTimezone } from "@/lib/display-timezone-server";
import { describePrescription, groupPrintWeeks, releasedDayIds, writeInBoxes, type PrintDay } from "@/lib/program-print";

// A printable copy of a program (Ron: a coach must never be stuck in our software). Plain black on white, one line per exercise with its prescription and blank boxes to write in
// what was actually done, grouped by week and day, several days across the page. No videos. The coach can print ANY program they coach, any time. A client or a member of a group program prints only
// the days already released to them (the same rule the app uses to show them). "Print or save as PDF" uses the browser's own print.
export default async function PrintProgramPage(props: { params: Promise<{ programId: string }> }) {
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: program } = await supabase
    .from("programs")
    .select("id, name, description, group_id, athlete_id, start_date, training_days, visibility_window")
    .eq("id", params.programId)
    .maybeSingle();
  if (!program) return <NoAccess>This program isn&apos;t available, or you don&apos;t have access to it.</NoAccess>;

  const { data: membership } = await supabase.from("group_memberships").select("role").eq("group_id", program.group_id).eq("profile_id", user.id).maybeSingle();
  if (!membership) return <NoAccess>This program isn&apos;t available, or you don&apos;t have access to it.</NoAccess>;
  const isCoach = membership.role === "coach";

  const { data: rows, error } = await supabase
    .from("workouts")
    .select(`id, title, week_number, day_index, scheduled_date, group_workout_exercises ( id, exercise_name, display_name, exercise_order, group_workout_exercise_sets ( ${SET_ROW_SELECT} ) )`)
    .eq("program_id", program.id)
    .order("week_number", { ascending: true })
    .order("day_index", { ascending: true });
  if (error) return <NoAccess>This program couldn&apos;t be loaded right now. Try again in a moment.</NoAccess>;

  const days: PrintDay[] = (rows ?? []).map((w: any) => ({
    id: w.id as string,
    title: (w.title as string) || `Day ${w.day_index}`,
    weekNumber: w.week_number as number,
    dayIndex: w.day_index as number,
    exercises: [...(w.group_workout_exercises ?? [])]
      .sort((a: any, b: any) => a.exercise_order - b.exercise_order)
      .map((e: any) => ({
        name: (e.display_name as string | null)?.trim() || (e.exercise_name as string),
        prescription: describePrescription((e.group_workout_exercise_sets ?? []).map(mapSetRow)),
        boxes: writeInBoxes((e.group_workout_exercise_sets ?? []).map(mapSetRow)),
      })),
  }));

  // Who sees what: the coach everything; anyone else (a client printing their own copy, or a member of a group program) only the days already released to them. The database also hides a
  // locked day's exercises, so a day that comes back with none is left out too (the app and the database can differ by a few hours around midnight).
  // A day prints the calendar date it falls on, when the program has a start date and training days.
  const dates =
    program.start_date && program.training_days && program.training_days.length > 0
      ? computeScheduledDates(program.start_date, program.training_days, (rows ?? []).map((w: any) => ({ id: w.id as string, scheduledDate: w.scheduled_date as string | null })))
      : new Map<string, Date>();
  for (const d of days) {
    const when = dates.get(d.id);
    if (when) d.dateLabel = formatShortDate(when);
  }
  let keep: Set<string> | undefined;
  if (!isCoach) {
    const timezone = await getGroupCoachTimezone(supabase, program.group_id);
    const today = nowInZone(timezone);
    keep = releasedDayIds(days, (id) => isLocked(dates.get(id), today, program.visibility_window));
  }
  const weeks = groupPrintWeeks(days, keep);

  let forName: string | null = null;
  if (program.athlete_id) {
    const { data: person } = await supabase.from("profiles").select("full_name").eq("id", program.athlete_id).maybeSingle();
    forName = (person as { full_name?: string | null } | null)?.full_name?.trim() || null;
  } else {
    const { data: group } = await supabase.from("groups").select("name").eq("id", program.group_id).maybeSingle();
    forName = (group as { name?: string | null } | null)?.name?.trim() || null;
  }

  const printedZone = await getViewerDisplayTimezone(supabase, user.id);

  return (
    <div className="print-sheet bg-white text-black min-h-screen px-8 py-6 font-body">
      <style>{`
        @page { margin: 12mm; }
        @media print {
          html, body { background: #fff !important; }
          .no-print { display: none !important; }
          .print-sheet { padding: 0 !important; }
        }
        .print-day { break-inside: avoid; page-break-inside: avoid; }
        .print-week { column-count: 2; column-gap: 24px; }
        @media (max-width: 700px) { .print-week { column-count: 1; } }
      `}</style>
      <div className="no-print flex items-center justify-between gap-3 mb-4">
        <p className="text-sm text-gray-600">Use Print, then choose &quot;Save as PDF&quot; to keep a copy.</p>
        <PrintButton />
      </div>
      <header className="border-b border-black pb-2 mb-4">
        <h1 className="text-2xl font-bold uppercase">{program.name}</h1>
        <p className="text-sm">
          {forName ? `${forName} · ` : ""}Printed {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: printedZone })}
        </p>
        {program.description && <p className="text-sm mt-1"><span className="font-semibold">Description: </span>{program.description}</p>}
      </header>

      {weeks.length === 0 && <p className="text-sm">There are no workouts to print yet.</p>}
      {weeks.map((w) => (
        <section key={w.weekNumber} className="mb-5">
          <h2 className="text-sm font-bold uppercase tracking-wide border-b border-gray-400 mb-2">Week {w.weekNumber}</h2>
          <div className="print-week">
            {w.days.map((d) => (
              <div key={d.id} className="print-day mb-3">
                <h3 className="text-sm font-bold">
                  {d.title}
                  {d.dateLabel && <span className="font-normal text-gray-600"> {"\u00b7"} {d.dateLabel}</span>}
                </h3>
                {d.exercises.length === 0 && <p className="text-xs text-gray-600">No exercises.</p>}
                <ul>
                  {d.exercises.map((e, i) => (
                    <li key={i} className="flex items-center gap-2 border-b border-gray-300 py-1 text-xs">
                      <span className="flex-1 min-w-0">
                        <span className="font-medium">{e.name}</span>
                        {e.prescription && <span className="text-gray-700"> {e.prescription}</span>}
                      </span>
                      <span className="inline-flex items-center gap-1 shrink-0">
                        <span className="text-[10px] text-gray-500">{e.boxes?.[0] ?? "Wt"}</span>
                        <span className="inline-block w-12 h-5 border border-gray-500" />
                        <span className="text-[10px] text-gray-500">{e.boxes?.[1] ?? "Reps"}</span>
                        <span className="inline-block w-12 h-5 border border-gray-500" />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
