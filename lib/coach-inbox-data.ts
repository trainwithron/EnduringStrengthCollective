import type { SupabaseClient } from "@supabase/supabase-js";
import { getCoachedGroups, groupsInOrgOf } from "@/lib/coach-groups";
import { buildCoachInbox, type InboxConversation } from "@/lib/coach-inbox";

// The coach's one inbox as data: every client across the groups the coach coaches in the organization, with the newest message and the unread count. Shared by the All messages page and the
// floating panel's Messages tab, so the two always list the same conversations the same way. Reads only; nothing is marked read here.
export async function loadCoachInbox(supabase: SupabaseClient, args: { coachId: string; groupId: string }): Promise<{ conversations: InboxConversation[]; groupName: string }> {
  const { coachId, groupId } = args;
  const coachedGroups = groupsInOrgOf(await getCoachedGroups(supabase, coachId), groupId);
  const scopeGroups = coachedGroups.length > 0 ? coachedGroups : [{ id: groupId, kind: "team" as const }];
  const scopeIds = scopeGroups.map((g) => g.id);
  const kindByGroup = new Map(scopeGroups.map((g) => [g.id, g.kind]));
  const [{ data: group }, { data: roster }, { data: messages }] = await Promise.all([
    supabase.from("groups").select("name").eq("id", groupId).single(),
    supabase.from("group_memberships").select("profile_id, group_id, profiles ( full_name, avatar_url )").in("group_id", scopeIds).eq("role", "athlete"),
    supabase.from("direct_messages").select("group_id, sender_id, recipient_id, body, created_at, read_at").in("group_id", scopeIds).or(`sender_id.eq.${coachId},recipient_id.eq.${coachId}`),
  ]);
  const people = (roster ?? []).map((r: any) => ({
    id: r.profile_id as string,
    fullName: (r.profiles?.full_name ?? "Athlete") as string,
    avatarUrl: (r.profiles?.avatar_url ?? null) as string | null,
    groupId: r.group_id as string,
    groupKind: kindByGroup.get(r.group_id) ?? ("team" as const),
  }));
  return { conversations: buildCoachInbox(people, messages ?? [], coachId), groupName: (group as { name?: string } | null)?.name ?? "Coaching" };
}
