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
  // A voice note (migration 0464): where the recording is and how long it is. Empty for words.
  voice_path?: string | null;
  voice_seconds?: number | null;
}

export async function loadDirectThread(supabase: SupabaseClient, args: { groupId: string; viewerId: string; otherId: string }): Promise<ThreadMessage[]> {
  const { groupId, viewerId, otherId } = args;
  const pair = `and(sender_id.eq.${viewerId},recipient_id.eq.${otherId}),and(sender_id.eq.${otherId},recipient_id.eq.${viewerId})`;
  // Newest columns first; before a database update adds them the read errors and is made again with fewer (0464: the voice note columns, 0315: the away-reply marker), so a
  // thread is never empty.
  const withVoice = await supabase.from("direct_messages").select("id, sender_id, body, created_at, auto_reply, voice_path, voice_seconds").eq("group_id", groupId).or(pair).order("created_at", { ascending: true });
  const first = withVoice.error ? await supabase.from("direct_messages").select("id, sender_id, body, created_at, auto_reply").eq("group_id", groupId).or(pair).order("created_at", { ascending: true }) : withVoice;
  let messages: ThreadMessage[] | null = first.data as ThreadMessage[] | null;
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
