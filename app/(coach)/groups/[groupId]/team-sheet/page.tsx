import { redirect } from "next/navigation";
import { LoadFailedPage } from "@/components/ui/load-failed-page";
import { isReadFailure } from "@/lib/read-failed";
import { NoAccess } from "@/components/shared/no-access";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { TeamSheetDownloadForm } from "@/components/coach/team-sheet-download-form";
import { DEFAULT_COACH_TIMEZONE, dateKeyInZone } from "@/lib/timezone";
import { loadSheetOptions } from "@/lib/team-sheet/load-sheet";

export const metadata = { title: "Team sheet" };

// Print the day's (or the week's) workout for the team, one sheet per rack, so athletes can write their weights on paper. Reading the filled sheets back in is a later step.
export default async function TeamSheetPage(props: { params: Promise<{ groupId: string }> }) {
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership, error: membershipError } = await supabase.from("group_memberships").select("role").eq("group_id", params.groupId).eq("profile_id", user.id).maybeSingle();
  if (isReadFailure(membershipError)) return <LoadFailedPage />;
  if (membership?.role !== "coach") return <NoAccess>Only a coach of this group can make its team sheet.</NoAccess>;

  const [{ data: group }, { data: zoneRow }, loaded] = await Promise.all([
    supabase.from("groups").select("name").eq("id", params.groupId).single(),
    supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle(),
    loadSheetOptions(supabase, params.groupId),
  ]);
  if (!loaded.ok) return <LoadFailedPage />;
  const timeZone = (zoneRow as { timezone?: string | null } | null)?.timezone || DEFAULT_COACH_TIMEZONE;

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="team-sheet">
      <div className="pb-6 border-b border-steel/20 mb-6">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">Team sheet</h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">Print the workout for the weight room, one sheet for each rack. Athletes write their weights on paper; the coach keeps the sheets.</p>
      </div>
      <TeamSheetDownloadForm groupId={params.groupId} today={dateKeyInZone(timeZone)} options={loaded.options} />
    </CoachDesktopShell>
  );
}
