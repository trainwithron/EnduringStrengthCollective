import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { loadPendingInvitees, type PendingInvitee } from "@/lib/coach-invite-server";

// The coaches of one group who have not accepted their invitation yet. The invitation already gave them a coach seat in the group, so every list of "the coaches" would otherwise show and count them as working
// coaches. Used to MARK them in the Coaches list (with Send again / Copy link / Cancel) and to LEAVE THEM OUT of pickers and tallies (who to message, who to give a revenue share, who can hold a depth-chart scope).
// Server only (reads sign-in accounts with the server key); never throws: a read that fails lists nobody as pending (the list then looks as it did before this).
export interface GroupCoachRow {
  profileId: string;
  fullName: string;
  avatarUrl: string | null;
  orgRole: string; // owner, admin or coach
}

export async function loadGroupCoaches(groupId: string): Promise<{ organizationId: string | null; coaches: GroupCoachRow[]; pending: PendingInvitee[] }> {
  try {
    const db = createServiceRoleClient();
    const { data: group } = await db.from("groups").select("organization_id").eq("id", groupId).maybeSingle();
    const organizationId = (group as { organization_id?: string | null } | null)?.organization_id ?? null;
    const { data: seats } = await db.from("group_memberships").select("profile_id, profiles ( full_name, avatar_url )").eq("group_id", groupId).eq("role", "coach");
    const seatRows = (seats ?? []) as unknown as { profile_id: string; profiles: { full_name: string | null; avatar_url: string | null } | { full_name: string | null; avatar_url: string | null }[] | null }[];
    const roles = new Map<string, string>();
    if (organizationId && seatRows.length > 0) {
      const { data: orgRows } = await db.from("organization_memberships").select("profile_id, role").eq("organization_id", organizationId).in("profile_id", seatRows.map((s) => s.profile_id));
      for (const r of (orgRows ?? []) as { profile_id: string; role: string }[]) roles.set(r.profile_id, r.role);
    }
    const coaches: GroupCoachRow[] = seatRows.map((s) => {
      const p = Array.isArray(s.profiles) ? s.profiles[0] : s.profiles;
      return { profileId: s.profile_id, fullName: p?.full_name ?? "Unknown", avatarUrl: p?.avatar_url ?? null, orgRole: roles.get(s.profile_id) ?? "coach" };
    });
    const pending = organizationId
      ? await loadPendingInvitees(
          db,
          organizationId,
          coaches.filter((c) => c.orgRole !== "owner").map((c) => ({ profileId: c.profileId, name: c.fullName, role: c.orgRole }))
        )
      : [];
    return { organizationId, coaches, pending };
  } catch {
    return { organizationId: null, coaches: [], pending: [] };
  }
}

/** The ids of a group's coaches who have not accepted yet, for filtering pickers and tallies. */
export async function pendingCoachIds(groupId: string): Promise<Set<string>> {
  return new Set((await loadGroupCoaches(groupId)).pending.map((p) => p.profileId));
}
