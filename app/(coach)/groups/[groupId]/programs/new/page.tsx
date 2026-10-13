import { NoAccess } from "@/components/shared/no-access";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { CreateAndOpenProgram } from "@/components/coach/create-and-open-program";

// "New program" and "Build program": there is no screen to fill in. The program is made at once and the builder opens (components/coach/create-and-open-program.tsx); the AI Program Builder is at
// the top of the builder. An old link with ?method=ai goes to the import page, which is still there.
export default async function NewProgramPage(
  props: {
    params: Promise<{ groupId: string }>;
    searchParams: Promise<{ method?: string; athleteId?: string }>;
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

  if (searchParams.method === "ai") {
    redirect(`/groups/${params.groupId}/programs/import${searchParams.athleteId ? `?athleteId=${encodeURIComponent(searchParams.athleteId)}` : ""}`);
  }

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", params.groupId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (membership?.role !== "coach") {
    return <NoAccess>Only coaches can create training programs.</NoAccess>;
  }

  const { data: group } = await supabase.from("groups").select("name, group_kind").eq("id", params.groupId).single();

  // For a client: the one named in the address, checked against this group's own roster; in a client's own one-on-one space, its one client.
  let wantedAthleteId: string | undefined = searchParams.athleteId;
  if (!wantedAthleteId && (group as { group_kind?: string } | null)?.group_kind === "one_on_one") {
    const { data: soleAthletes } = await supabase.from("group_memberships").select("profile_id").eq("group_id", params.groupId).eq("role", "athlete");
    if (soleAthletes?.length === 1) wantedAthleteId = soleAthletes[0].profile_id as string;
  }
  let athleteFirstName: string | null = null;
  let athleteId: string | null = null;
  if (wantedAthleteId) {
    const { data: athleteMembership } = await supabase
      .from("group_memberships")
      .select("role, profiles ( full_name )")
      .eq("group_id", params.groupId)
      .eq("profile_id", wantedAthleteId)
      .maybeSingle();
    if (athleteMembership?.role === "athlete") {
      athleteId = wantedAthleteId;
      const full = ((athleteMembership.profiles as { full_name?: string | null } | null)?.full_name ?? "").trim();
      athleteFirstName = full.split(/\s+/)[0] || "Client";
    }
  }

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="programs">
      <CreateAndOpenProgram groupId={params.groupId} createdBy={user.id} athleteId={athleteId} athleteFirstName={athleteFirstName} />
    </CoachDesktopShell>
  );
}
