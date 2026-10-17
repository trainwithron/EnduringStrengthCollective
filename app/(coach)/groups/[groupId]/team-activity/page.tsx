import { redirect } from "next/navigation";
import Link from "next/link";
import { LoadFailedPage } from "@/components/ui/load-failed-page";
import { isReadFailure } from "@/lib/read-failed";
import { NoAccess } from "@/components/shared/no-access";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { activityPeriod, loadCoachActivity } from "@/lib/coach-activity";
import { DEFAULT_COACH_TIMEZONE } from "@/lib/timezone";
import { CoachActivityTable } from "@/components/org/coach-activity-table";

// What each coach in the organization has done in a period, for the owner and admins: clients, sessions delivered, no-shows and late cancels, quiet clients, low balances, and a payroll ESTIMATE with a spreadsheet
// of the sessions behind it. Counts only what row security shows the viewer: a client who keeps their records private from the organization is not in these numbers.
export default async function TeamActivityPage(props: { params: Promise<{ groupId: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const params = await props.params;
  const search = await props.searchParams;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership, error: membershipError } = await supabase.from("group_memberships").select("role").eq("group_id", params.groupId).eq("profile_id", user.id).maybeSingle();
  if (isReadFailure(membershipError)) return <LoadFailedPage />;
  if (membership?.role !== "coach") return <NoAccess>Only a coach of this organization can open this page.</NoAccess>;

  const { data: group } = await supabase.from("groups").select("name, organization_id").eq("id", params.groupId).single();
  const { data: orgMembership } = group?.organization_id
    ? await supabase.from("organization_memberships").select("role").eq("organization_id", group.organization_id).eq("profile_id", user.id).maybeSingle()
    : { data: null };
  if (orgMembership?.role !== "owner" && orgMembership?.role !== "admin") return <NoAccess>Only the owner and admins can see what each coach has done.</NoAccess>;

  // Days are cut at midnight in the viewer's own time zone (their profile's), and the zone is shown on the page and in the spreadsheet.
  const { data: zoneRow } = await supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle();
  const timeZone = (zoneRow as { timezone?: string | null } | null)?.timezone || DEFAULT_COACH_TIMEZONE;
  const period = activityPeriod(search.from, search.to, timeZone);
  const activity = await loadCoachActivity(supabase, { orgId: group!.organization_id as string, fromIso: period.fromIso, toIso: period.toIso });

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="branding">
      <div className="pb-6 border-b border-steel/20 mb-6">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">Coach activity</h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">
          What each coach has done in the period. A session counts when it was confirmed, its time has passed and it was not a no-show. Clients who keep their records private from the organization are not counted.
        </p>
        <p className="font-body text-xs mt-2">
          <Link href={`/groups/${params.groupId}/branding?tab=team`} className="text-rust">
            &larr; Back to the team
          </Link>
        </p>
      </div>
      {activity.failed && (
        <p className="font-body text-sm text-rust mb-4" role="alert">
          Some of this could not be read, so the numbers below may be too low. Reload the page to try again.
        </p>
      )}
      {activity.truncated && (
        <p className="font-body text-sm text-rust mb-4" role="alert">
          This period has more than the page can show. Choose a shorter period.
        </p>
      )}
      <CoachActivityTable groupId={params.groupId} fromDay={period.fromDay} toDay={period.toDay} timeZone={period.timeZone} rows={activity.rows} creditsSold={activity.creditsSold} />
    </CoachDesktopShell>
  );
}
