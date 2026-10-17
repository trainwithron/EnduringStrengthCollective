import { redirect } from "next/navigation";
import { LoadFailedPage } from "@/components/ui/load-failed-page";
import { isReadFailure } from "@/lib/read-failed";
import { NoAccess } from "@/components/shared/no-access";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { activityPeriod } from "@/lib/coach-activity";
import { loadAttendance } from "@/lib/attendance";
import { DEFAULT_COACH_TIMEZONE, addDaysToKey, dateKeyInZone } from "@/lib/timezone";
import { AttendanceView } from "@/components/coach/desktop/attendance-view";

// Who was there: a day-by-day grid for the group over a period, with a spreadsheet of every day each athlete was present. Present = checked in at the kiosk, finished a workout in this group, or attended a group
// session, that day in the coach's time zone.
export default async function AttendancePage(props: { params: Promise<{ groupId: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const params = await props.params;
  const search = await props.searchParams;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership, error: membershipError } = await supabase.from("group_memberships").select("role").eq("group_id", params.groupId).eq("profile_id", user.id).maybeSingle();
  if (isReadFailure(membershipError)) return <LoadFailedPage />;
  if (membership?.role !== "coach") return <NoAccess>Only a coach of this group can see its attendance.</NoAccess>;

  const [{ data: group }, { data: zoneRow }] = await Promise.all([
    supabase.from("groups").select("name").eq("id", params.groupId).single(),
    supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle(),
  ]);
  const timeZone = (zoneRow as { timezone?: string | null } | null)?.timezone || DEFAULT_COACH_TIMEZONE;
  // The default is the last 14 days, not the month so far: a team looks at the last two weeks.
  const now = new Date();
  const defaultFrom = addDaysToKey(dateKeyInZone(timeZone, now), -13);
  const period = activityPeriod(search.from ?? defaultFrom, search.to, timeZone, now);
  const attendance = await loadAttendance(supabase, { groupId: params.groupId, fromIso: period.fromIso, toIso: period.toIso, fromDay: period.fromDay, toDay: period.toDay, timeZone });

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="attendance">
      <div className="pb-6 border-b border-steel/20 mb-6">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">Attendance</h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">Who was there, day by day. Present means checked in at the kiosk, finished a workout in this group, or attended a group session that day ({timeZone}).</p>
      </div>
      {attendance.failed && (
        <p className="font-body text-sm text-rust mb-4" role="alert">
          Some of this could not be read, so people may show as absent who were there. Reload the page to try again.
        </p>
      )}
      {attendance.truncated && (
        <p className="font-body text-sm text-rust mb-4" role="alert">
          This period has more than the page can show. Choose a shorter period.
        </p>
      )}
      <AttendanceView groupId={params.groupId} fromDay={period.fromDay} toDay={period.toDay} athletes={attendance.athletes} dayKeys={attendance.dayKeys} />
    </CoachDesktopShell>
  );
}
