import type { SupabaseClient } from "@supabase/supabase-js";
import { getCoachedGroups, groupsInOrgOf } from "@/lib/coach-groups";
import { buildCoachInbox, type InboxConversation } from "@/lib/coach-inbox";
import { pageAll } from "@/lib/page-all";

// The coach's one inbox as data: every client across the groups the coach coaches in the organization, with the newest message and the unread count. Shared by the All messages page and the
// floating panel's Messages tab, so the two always list the same conversations the same way. Reads only; nothing is marked read here.
export async function loadCoachInbox(supabase: SupabaseClient, args: { coachId: string; groupId: string }): Promise<{ conversations: InboxConversation[]; groupName: string; incomplete: boolean }> {
  const { coachId, groupId } = args;
  const coachedGroups = groupsInOrgOf(await getCoachedGroups(supabase, coachId), groupId);
  const scopeGroups = coachedGroups.length > 0 ? coachedGroups : [{ id: groupId, kind: "team" as const }];
  const scopeIds = scopeGroups.map((g) => g.id);
  const kindByGroup = new Map(scopeGroups.map((g) => [g.id, g.kind]));
  // The messages are read a page at a time (PostgREST stops at 1,000 rows), in a fixed order, so the newest message and the unread count of every conversation are right however many there are.
  const readMessages = (columns: string) =>
    pageAll((from, to) =>
      supabase
        .from("direct_messages")
        .select(columns)
        .in("group_id", scopeIds)
        .or(`sender_id.eq.${coachId},recipient_id.eq.${coachId}`)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
    );
  const [{ data: group }, { data: roster }, firstPages] = await Promise.all([
    supabase.from("groups").select("name").eq("id", groupId).single(),
    supabase.from("group_memberships").select("profile_id, group_id, profiles ( full_name, avatar_url )").in("group_id", scopeIds).eq("role", "athlete"),
    readMessages("id, group_id, sender_id, recipient_id, body, created_at, read_at, auto_reply"),
  ]);
  // Before the 0315 database update there is no auto_reply column and that read fails: read again with the old column list so the inbox is never empty.
  const messagePages = firstPages.failed && firstPages.rows.length === 0 ? await readMessages("id, group_id, sender_id, recipient_id, body, created_at, read_at") : firstPages;
  const messages = messagePages.rows;
  const people = (roster ?? []).map((r: any) => ({
    id: r.profile_id as string,
    fullName: (r.profiles?.full_name ?? "Athlete") as string,
    avatarUrl: (r.profiles?.avatar_url ?? null) as string | null,
    groupId: r.group_id as string,
    groupKind: kindByGroup.get(r.group_id) ?? ("team" as const),
  }));
  return {
    conversations: buildCoachInbox(people, messages, coachId),
    groupName: (group as { name?: string } | null)?.name ?? "Coaching",
    // A failed or cut-off read means some conversations may show an older last message or a short unread count: the screen says so instead of looking complete.
    incomplete: messagePages.failed || messagePages.truncated,
  };
}
