import type { SupabaseClient } from "@supabase/supabase-js";

// A package can include access to a group (migration 0317): the buyer becomes a member of that group and sees its programs. Like a linked program (lib/package-program-access.ts) it runs
// with the service role, so the group is checked here: it has to be a group this same coach coaches. Selling sessions never attaches a program, and a package with no group does nothing here.
export async function groupBelongsToCoach(supabase: SupabaseClient, coachId: string, groupId: string): Promise<boolean> {
  const { data } = await supabase.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", coachId).eq("role", "coach").maybeSingle();
  return !!data;
}

// Gives the buyer access to the package's group (idempotent: a second call changes nothing). If they are already a member, nothing is added and the group keeps them whatever happens to
// the package; if the package is what makes them a member, that is recorded so a lapse can take it back. Returns an error text only when something was meant to happen and did not.
export async function grantLinkedGroupAccess(
  supabase: SupabaseClient,
  { coachPackageId, athleteId }: { coachPackageId: string | null; athleteId: string }
): Promise<{ granted: boolean; error?: string }> {
  if (!coachPackageId) return { granted: false };
  const { data: pkg } = await supabase.from("coach_packages").select("coach_id, group_access_group_id").eq("id", coachPackageId).maybeSingle();
  const groupId = (pkg as { group_access_group_id?: string | null } | null)?.group_access_group_id ?? null;
  if (!pkg || !groupId) return { granted: false };
  // Checked again at grant time: the link may predate the ownership check, and this runs with the service role.
  if (!(await groupBelongsToCoach(supabase, (pkg as { coach_id: string }).coach_id, groupId))) return { granted: false, error: "That group is not one of this coach's groups." };

  const { data: existing } = await supabase.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", athleteId).maybeSingle();
  let createdMembership = false;
  if (!existing) {
    const { error } = await supabase.from("group_memberships").insert({ group_id: groupId, profile_id: athleteId, role: "athlete" });
    if (error) return { granted: false, error: "Couldn't add the client to the group." };
    createdMembership = true;
  }
  const { error: recordError } = await supabase
    .from("package_group_access")
    .upsert({ athlete_id: athleteId, group_id: groupId, coach_package_id: coachPackageId, created_membership: createdMembership }, { onConflict: "athlete_id,group_id,coach_package_id", ignoreDuplicates: true });
  if (recordError) return { granted: true, error: "Added to the group, but couldn't record why." };
  return { granted: true };
}

// A subscription lapsed: the group access it gave ends. The client is removed from the group only if this package is what put them there and no other package still gives them the same group.
// A client who was already a member by other means, or who joined later in another way, stays. The program copy and the sessions are not touched here.
export async function revokeLinkedGroupAccess(
  supabase: SupabaseClient,
  { coachPackageId, athleteId }: { coachPackageId: string | null; athleteId: string }
): Promise<{ removed: boolean }> {
  if (!coachPackageId) return { removed: false };
  const { data: rows } = await supabase.from("package_group_access").select("group_id, created_membership").eq("coach_package_id", coachPackageId).eq("athlete_id", athleteId);
  let removed = false;
  for (const row of (rows ?? []) as { group_id: string; created_membership: boolean }[]) {
    await supabase.from("package_group_access").delete().eq("coach_package_id", coachPackageId).eq("athlete_id", athleteId).eq("group_id", row.group_id);
    if (!row.created_membership) continue;
    const { data: others } = await supabase.from("package_group_access").select("coach_package_id").eq("athlete_id", athleteId).eq("group_id", row.group_id).limit(1);
    if ((others ?? []).length > 0) continue;
    const { error } = await supabase.from("group_memberships").delete().eq("group_id", row.group_id).eq("profile_id", athleteId).eq("role", "athlete");
    if (!error) removed = true;
  }
  return { removed };
}
