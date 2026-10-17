import { LoadFailedPage } from "@/components/ui/load-failed-page";
import { NoAccess } from "@/components/shared/no-access";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { CreateAndOpenProgram } from "@/components/coach/create-and-open-program";
import { getCoachedGroups, pickAnchorGroup } from "@/lib/coach-groups";

// "New program" and "Build program": there is no screen to fill in. The program is made at once and the builder opens (components/coach/create-and-open-program.tsx); the AI Program Builder is at
// the top of the builder. An old link with ?method=ai now does the same: the builder opens with its AI box, which builds from a description and offers to import pasted program text.
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

  const { data: membership, error: membershipError } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", params.groupId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (membershipError) return <LoadFailedPage />;

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

  // Started from a client's page: the program is the coach's own (no client on it) and lives with their other programs; "Assign to [First]" in the builder gives the client their own copy.
  // A client's own space cannot hold a program with no client, so the program is made in the coach's team or social group of the same organization. (The coach's own training space keeps
  // building programs for the coach, as before.)
  let targetGroupId = params.groupId;
  let forClient: { id: string; groupId: string } | null = null;
  if (athleteId) {
    const coached = await getCoachedGroups(supabase, user.id);
    const here = coached.find((g) => g.id === params.groupId);
    if (here) {
      const library = here.kind === "one_on_one" ? pickAnchorGroup(coached, null, here.orgId) : here;
      if (library && library.kind !== "one_on_one") {
        targetGroupId = library.id;
        forClient = { id: athleteId, groupId: params.groupId };
      }
    }
  }

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="programs">
      <CreateAndOpenProgram groupId={targetGroupId} createdBy={user.id} athleteId={forClient ? null : athleteId} athleteFirstName={athleteFirstName} forClient={forClient} />
    </CoachDesktopShell>
  );
}
