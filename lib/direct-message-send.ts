import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyPush } from "@/lib/push-notify";
import { VOICE_BUCKET, VOICE_MAX_SECONDS, VOICE_NOTE_BODY, baseMimeType, voiceNotePushTitle, voicePath } from "@/lib/voice-note";

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

// A voice note (R7, Ron Nov 20): the recording is put in the sender's own folder of the private voice-notes bucket, then sent as a message through the same row (and the same
// row security, minors rule included) as words, with the file named on it. If the message is refused, the file is taken back out so nothing is left unheard. The push reads
// "{Name} sent a voice note". Returns null when either step fails (the composer then says so and keeps the recording).
export interface SentVoiceNote extends SentDirectMessage {
  voice_path: string;
  voice_seconds: number;
}

export async function sendVoiceNote(
  supabase: SupabaseClient,
  msg: { groupId: string; senderId: string; senderName: string; recipientId: string; audio: Blob; mimeType: string; seconds: number; fileId?: string }
): Promise<SentVoiceNote | null> {
  const seconds = Math.round(msg.seconds);
  if (!(seconds >= 1 && seconds <= VOICE_MAX_SECONDS) || msg.audio.size === 0) return null;
  const path = voicePath(msg.senderId, msg.groupId, msg.fileId ?? crypto.randomUUID(), msg.mimeType);
  if (!path) return null;
  try {
    const upload = await supabase.storage.from(VOICE_BUCKET).upload(path, msg.audio, { contentType: baseMimeType(msg.mimeType), upsert: false });
    if (upload.error) return null;
    const { data, error } = await supabase
      .from("direct_messages")
      .insert({ group_id: msg.groupId, sender_id: msg.senderId, recipient_id: msg.recipientId, body: VOICE_NOTE_BODY, voice_path: path, voice_seconds: seconds })
      .select("id, sender_id, body, created_at, voice_path, voice_seconds")
      .single();
    if (error || !data) {
      await supabase.storage.from(VOICE_BUCKET).remove([path]).catch(() => undefined);
      return null;
    }
    notifyPush(msg.recipientId, voiceNotePushTitle(msg.senderName), "Open Messages to listen.", `/groups/${msg.groupId}/messages/${msg.senderId}`);
    return data as SentVoiceNote;
  } catch {
    return null;
  }
}

// Where a coach opens their conversation with one client (on a computer this lands on the client's Messages tab; on a phone, the conversation itself).
export function coachThreadHref(groupId: string, athleteId: string): string {
  return `/groups/${groupId}/messages/${athleteId}`;
}
