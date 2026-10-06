import { redirect } from "next/navigation";
import { NoAccess } from "@/components/shared/no-access";
import { createServerClient } from "@/lib/supabase/server";
import { KioskCheckinScreen } from "@/components/coach/kiosk-checkin-screen";
import { loadKioskPinStatus } from "@/lib/kiosk-pin-status";

// The locked-down tablet-at-the-entrance screen (mobile_more_tab_
// condensed_widget_hub_sept30.md's Kiosk Check-In follow-up). Same
// bare-page precedent as app/groups/[groupId]/display/page.tsx — never
// wrapped in CoachDesktopShell, so there's no sidebar/nav chrome and no
// in-app link out to the rest of the admin app. Still a completely
// normal authenticated coach page underneath (gated the same way every
// other coach-only page is) — "lockdown" here means nothing to tap out
// through, not a browser-level kiosk API. Meant to be opened once on a
// shared tablet and left running; a coach reaches PIN management and
// the "Open Kiosk Mode" link from the separate /kiosk/settings page
// instead, never from here.
export default async function KioskPage(
  props: { params: Promise<{ groupId: string }> }
) {
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", params.groupId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (membership?.role !== "coach") {
    return (
      <NoAccess>Only coaches can open Kiosk Check-In.</NoAccess>
    );
  }

  const { data: group } = await supabase
    .from("groups")
    .select("name")
    .eq("id", params.groupId)
    .maybeSingle();

  const { data: memberships } = await supabase
    .from("group_memberships")
    .select("profile_id, profiles ( full_name )")
    .eq("group_id", params.groupId)
    .eq("role", "athlete");
  const pinStatus = await loadKioskPinStatus(supabase, params.groupId);

  const roster = (memberships ?? [])
    .map((m: any) => ({
      athleteId: m.profile_id as string,
      fullName: (m.profiles?.full_name as string | null) ?? "Unknown",
      hasPin: pinStatus.get(m.profile_id as string) ?? false,
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  return (
    <KioskCheckinScreen
      groupId={params.groupId}
      groupName={group?.name ?? "Check In"}
      roster={roster}
    />
  );
}
