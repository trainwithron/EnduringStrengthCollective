import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { DEFAULT_COACH_TIMEZONE, localDayBounds } from "@/lib/timezone";
import { shortClientName } from "@/lib/low-session-digest";
import { readRowsByIds } from "@/lib/read-by-ids";
import { getActivePrograms } from "@/lib/active-programs";
import { STAYS_ON_TOP_MS, nextClientSessionToday, nextSessionLabel } from "@/lib/next-session-order";

// "Start <Client>'s workout" on the coach's Home (Ron, Oct 19: "a good place to put the Start Next Client Workout"): one big button for the client whose session is next today, with the session's time under it. It
// opens the same place "Log their workout" does (the client's log page, which picks up where their program left off). With no client session left today nothing is drawn, and the coach's own "Start workout" is
// untouched. A client with no program yet opens their profile instead, with one plain line saying so. Reads only; a failed read draws nothing. `groupIds` is the open organization's groups.
export async function loadNextClientToday(supabase: any, coachId: string, groupIds: string[], timezone: string, now: Date = new Date()) {
  const bounds = localDayBounds(timezone, now);
  const { data, error } = await readRowsByIds(groupIds, (ids) => (from, to) =>
    supabase
      .from("bookings")
      .select("id, athlete_id, group_id, start_at")
      .eq("coach_id", coachId)
      .in("group_id", ids)
      .eq("status", "confirmed")
      .is("attended_at", null)
      .eq("no_show", false)
      .gte("start_at", new Date(now.getTime() - STAYS_ON_TOP_MS).toISOString())
      .lt("start_at", bounds.endIso)
      .order("start_at")
      .order("id")
      .range(from, to)
  );
  if (error || !data) return null;
  const next = nextClientSessionToday((data as { id: string; athlete_id: string; group_id: string; start_at: string }[]).filter((r) => r.athlete_id !== coachId), timezone, now);
  if (!next) return null;
  const [{ data: profile }, programs] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", next.athlete_id).maybeSingle(),
    getActivePrograms(supabase, next.group_id, next.athlete_id),
  ]);
  return { athleteId: next.athlete_id, groupId: next.group_id, startIso: next.start_at, name: shortClientName((profile as { full_name?: string | null } | null)?.full_name), hasProgram: programs.length > 0 };
}

export async function NextClientWorkoutSection({ coachId, groupIds }: { coachId: string; groupIds: string[] }) {
  const supabase = await createServerClient();
  const now = new Date();
  const { data: me } = await supabase.from("profiles").select("timezone").eq("id", coachId).maybeSingle();
  const timezone = (me as { timezone?: string | null } | null)?.timezone || DEFAULT_COACH_TIMEZONE;
  const next = await loadNextClientToday(supabase, coachId, groupIds, timezone, now);
  if (!next) return null;
  const href = next.hasProgram ? `/groups/${next.groupId}/athletes/${next.athleteId}/log` : `/groups/${next.groupId}/athletes/${next.athleteId}`;
  return (
    <section aria-label="Next client workout" className="mb-6">
      <Link href={href} className="block w-full min-h-16 px-4 py-3 bg-rust text-graphite text-center">
        <span className="block font-display uppercase text-lg font-bold leading-tight">Start {next.name}&apos;s workout</span>
        <span className="block font-body text-sm">{nextSessionLabel(next.startIso, timezone, now)}</span>
      </Link>
      {!next.hasProgram && <p className="font-body text-sm text-steel mt-2">No program yet for {next.name}.</p>}
    </section>
  );
}
