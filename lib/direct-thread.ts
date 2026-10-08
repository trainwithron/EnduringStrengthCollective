import type { SupabaseClient } from "@supabase/supabase-js";

// One conversation between two people in a group: the messages, oldest first. Opening it is the "seen it" moment, so anything the other person sent is marked read, and the
// bell's "sent you a message" line for the conversation is marked seen too (the database writes that line when the message arrives, migration 0276; before that is applied there
// is nothing to mark and no row changes). Shared by the full Messages page and the Messages tab on a client's profile, so the two can never behave differently.
export interface ThreadMessage {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
  // A reply the database wrote from the coach's "I'm away" preset (migration 0315); the thread marks it.
  auto_reply?: boolean;
}

export async function loadDirectThread(supabase: SupabaseClient, args: { groupId: string; viewerId: string; otherId: string }): Promise<ThreadMessage[]> {
  const { groupId, viewerId, otherId } = args;
  const pair = `and(sender_id.eq.${viewerId},recipient_id.eq.${otherId}),and(sender_id.eq.${otherId},recipient_id.eq.${viewerId})`;
  const first = await supabase.from("direct_messages").select("id, sender_id, body, created_at, auto_reply").eq("group_id", groupId).or(pair).order("created_at", { ascending: true });
  let messages: ThreadMessage[] | null = first.data as ThreadMessage[] | null;
  // Before the 0315 database update the marker column does not exist and that read errors: read again without it so a thread is never empty.
  if (first.error) {
    const again = await supabase.from("direct_messages").select("id, sender_id, body, created_at").eq("group_id", groupId).or(pair).order("created_at", { ascending: true });
    messages = again.data;
  }

  const now = new Date().toISOString();
  await supabase.from("direct_messages").update({ read_at: now }).eq("group_id", groupId).eq("recipient_id", viewerId).eq("sender_id", otherId).is("read_at", null);
  await supabase
    .from("notifications")
    .update({ read_at: now })
    .eq("profile_id", viewerId)
    .eq("type", "direct_message")
    .eq("link_path", `/groups/${groupId}/messages/${otherId}`)
    .is("read_at", null);

  return (messages ?? []) as ThreadMessage[];
}
