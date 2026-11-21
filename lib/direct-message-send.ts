import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyPush } from "@/lib/push-notify";

// The one way a direct message is sent from the browser: the conversation's own composer (components/messages/direct-message-thread.tsx), the "Message {name}" nudge on Home
// (Ron, Nov 20: it sends inside Spotlight now, not through the phone's share sheet) and a coach's reply to a weekly check-in. The row is written with the sender's own session, so
// row security decides who may write to whom, exactly as before; the push to the other person goes out only once the row is saved (lib/push-notify.ts, best-effort).
export interface SentDirectMessage {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
}

export async function sendDirectMessage(
  supabase: SupabaseClient,
  msg: { groupId: string; senderId: string; senderName: string; recipientId: string; body: string }
): Promise<SentDirectMessage | null> {
  const trimmed = msg.body.trim();
  if (!trimmed) return null;
  try {
    const { data, error } = await supabase
      .from("direct_messages")
      .insert({ group_id: msg.groupId, sender_id: msg.senderId, recipient_id: msg.recipientId, body: trimmed })
      .select("id, sender_id, body, created_at")
      .single();
    if (error || !data) return null;
    notifyPush(msg.recipientId, `New message from ${msg.senderName}`, trimmed, `/groups/${msg.groupId}/messages/${msg.senderId}`);
    return data as SentDirectMessage;
  } catch {
    return null;
  }
}

// Where a coach opens their conversation with one client (on a computer this lands on the client's Messages tab; on a phone, the conversation itself).
export function coachThreadHref(groupId: string, athleteId: string): string {
  return `/groups/${groupId}/messages/${athleteId}`;
}
