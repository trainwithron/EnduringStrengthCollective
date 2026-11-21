"use client";

import { useEffect, useRef, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { sendDirectMessage, sendVoiceNote } from "@/lib/direct-message-send";
import { attachVisibleReader } from "@/lib/visible-read";
import { VoiceNotePlayer } from "@/components/messages/voice-note-player";
import { VoiceNoteRecorder } from "@/components/messages/voice-note-recorder";

interface MessageRow {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
  auto_reply?: boolean;
  // a voice note (migration 0464): played in place of the words
  voice_path?: string | null;
  voice_seconds?: number | null;
}

// Coach<->Athlete DM thread — realtime message list + composer, same
// subscribe-and-append pattern already proven by
// components/feed/inline-comment-section.tsx, just filtered to one
// group_id and then narrowed client-side to this exact (viewer, other)
// pair, since postgres_changes filters can't express an OR condition.
export function DirectMessageThread({
  groupId,
  viewerId,
  viewerName,
  otherId,
  otherName,
  initialMessages,
  fixedComposer = false,
  initialDraft = "",
}: {
  groupId: string;
  viewerId: string;
  viewerName: string;
  otherId: string;
  otherName: string;
  initialMessages: MessageRow[];
  fixedComposer?: boolean;
  // A draft the coach opens the thread with (for example the expiry check-in): shown in the box to edit, never sent by itself.
  initialDraft?: string;
}) {
  const [messages, setMessages] = useState<MessageRow[]>(initialMessages);
  const [body, setBody] = useState(initialDraft);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = createBrowserClient();
    // A message from the other person counts as read only while this page is in front of the coach: arriving in a background tab or an unfocused window leaves it unread (so the badge shows)
    // and it is marked read the moment the page comes back to the front. The update must be started with .then(): the query builder sends nothing until it is awaited.
    const reader = attachVisibleReader({
      doc: document,
      win: window,
      markRead: () => {
        supabase
          .from("direct_messages")
          .update({ read_at: new Date().toISOString() })
          .eq("group_id", groupId)
          .eq("recipient_id", viewerId)
          .eq("sender_id", otherId)
          .is("read_at", null)
          .then(() => undefined);
      },
    });
    const channel = supabase
      .channel(`dm:${groupId}:${[viewerId, otherId].sort().join(":")}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "direct_messages", filter: `group_id=eq.${groupId}` },
        (payload) => {
          const row = payload.new as any;
          const isThisPair =
            (row.sender_id === viewerId && row.recipient_id === otherId) ||
            (row.sender_id === otherId && row.recipient_id === viewerId);
          if (!isThisPair) return;
          setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
          // A message arriving live while this thread is open and in front of the coach is read; otherwise it waits (see above).
          if (row.sender_id === otherId) reader.onArrive();
        }
      )
      .subscribe();
    return () => {
      reader.dispose();
      supabase.removeChannel(channel);
    };
  }, [groupId, viewerId, otherId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  async function handleSend() {
    if (!body.trim() || sending) return;
    setSending(true);
    setError(null);
    // The same send (and push) as every other place a message goes from (lib/direct-message-send.ts).
    const inserted = await sendDirectMessage(createBrowserClient(), { groupId, senderId: viewerId, senderName: viewerName, recipientId: otherId, body });
    setSending(false);
    if (!inserted) {
      setError("Couldn't send — check your connection and try again.");
      return;
    }
    // Appended locally rather than waiting on the realtime echo of our
    // own insert — a real-time round trip for your own just-sent message
    // is an unnecessary dependency (and an unnecessary delay) when the
    // insert response already has everything needed to render it. The
    // postgres_changes subscription above is still what delivers the
    // OTHER party's messages while this thread is open.
    setMessages((prev) => (prev.some((m) => m.id === inserted.id) ? prev : [...prev, inserted]));
    setBody("");
  }

  // A voice note goes through the same send (lib/direct-message-send.ts): the file first, then the message that names it.
  async function handleVoice(audio: Blob, mimeType: string, seconds: number): Promise<boolean> {
    setError(null);
    const inserted = await sendVoiceNote(createBrowserClient(), { groupId, senderId: viewerId, senderName: viewerName, recipientId: otherId, audio, mimeType, seconds });
    if (!inserted) return false;
    setMessages((prev) => (prev.some((m) => m.id === inserted.id) ? prev : [...prev, inserted]));
    return true;
  }

  return (
    <div className="flex flex-col h-full">
      {/* With the composer fixed above the bottom bar (4.75rem bar + about 4.25rem composer), the newest message must clear both: room below the list, and the end marker keeps that much
          margin when it is scrolled to (audit, Nov 21: at 375px the newest message sat behind the box). */}
      <div className={`flex-1 overflow-y-auto space-y-3 px-5 py-4 ${fixedComposer ? "pb-[calc(9.75rem+env(safe-area-inset-bottom))]" : ""}`}>
        {messages.length === 0 && (
          <p className="font-body text-sm text-steel text-center mt-8">
            No messages yet — say hello to {otherName}.
          </p>
        )}
        {messages.map((m) => {
          const isOwn = m.sender_id === viewerId;
          return (
            <div key={m.id} className={`flex ${isOwn ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[75%] px-3 py-2 rounded-lg font-body text-sm whitespace-pre-wrap break-words ${
                  isOwn ? "bg-rust text-graphite" : "bg-surface border border-steel/20 text-chalk"
                }`}
              >
                {m.voice_path && m.voice_seconds ? <VoiceNotePlayer path={m.voice_path} seconds={m.voice_seconds} own={isOwn} /> : m.body}
                {m.auto_reply && <span className={`block text-[11px] mt-1 ${isOwn ? "text-graphite/70" : "text-steel"}`}>Auto-reply{isOwn ? " (sent because you are away)" : ""}</span>}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} className={fixedComposer ? "scroll-mb-[calc(9.75rem+env(safe-area-inset-bottom))]" : undefined} />
      </div>

      {error && (
        <p className="font-body text-xs text-rust-ink px-5" role="alert">
          {error}
        </p>
      )}

      <div
        className={
          fixedComposer
            ? "fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] inset-x-0 z-10 bg-graphite/95 backdrop-blur border-t border-steel/20 flex items-center gap-2 px-5 py-3"
            : "flex items-center gap-2 px-5 py-3 border-t border-steel/20 shrink-0"
        }
      >
        {/* The mic sits beside the box (hidden where the browser cannot record); while a voice note is being made the box steps aside for it. */}
        <VoiceNoteRecorder disabled={sending} onActiveChange={setRecording} onSend={handleVoice} />
        {!recording && (
          <>
            <input aria-label={`Message ${otherName}`}
              type="text"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSend();
              }}
              placeholder={`Message ${otherName}`}
              disabled={sending}
              className="flex-1 min-w-0 h-11 bg-surface border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust disabled:opacity-60"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || !body.trim()}
              className="h-11 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
            >
              {sending ? "…" : "Send"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
