"use client";

import { useEffect, useRef, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { notifyPush } from "@/lib/push-notify";

interface MessageRow {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
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
}: {
  groupId: string;
  viewerId: string;
  viewerName: string;
  otherId: string;
  otherName: string;
  initialMessages: MessageRow[];
  fixedComposer?: boolean;
}) {
  const [messages, setMessages] = useState<MessageRow[]>(initialMessages);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = createBrowserClient();
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
          // A message arriving live from the other party while this
          // thread is already open is effectively already read —
          // mark it so the conversation list's unread badge doesn't
          // lag behind reality until the next full page load.
          if (row.sender_id === otherId) {
            supabase.from("direct_messages").update({ read_at: new Date().toISOString() }).eq("id", row.id);
          }
        }
      )
      .subscribe();
    return () => {
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
    const trimmed = body.trim();
    const supabase = createBrowserClient();
    const { data: inserted, error: insertError } = await supabase
      .from("direct_messages")
      .insert({ group_id: groupId, sender_id: viewerId, recipient_id: otherId, body: trimmed })
      .select("id, sender_id, body, created_at")
      .single();
    setSending(false);
    if (insertError || !inserted) {
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
    notifyPush(otherId, `New message from ${viewerName}`, trimmed, `/groups/${groupId}/messages/${viewerId}`);
    setBody("");
  }

  return (
    <div className="flex flex-col h-full">
      <div className={`flex-1 overflow-y-auto space-y-3 px-5 py-4 ${fixedComposer ? "pb-24" : ""}`}>
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
                {m.body}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {error && (
        <p className="font-body text-xs text-rust px-5" role="alert">
          {error}
        </p>
      )}

      <div
        className={
          fixedComposer
            ? "fixed bottom-16 inset-x-0 z-10 bg-graphite/95 backdrop-blur border-t border-steel/20 flex items-center gap-2 px-5 py-3"
            : "flex items-center gap-2 px-5 py-3 border-t border-steel/20 shrink-0"
        }
      >
        <input
          type="text"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSend();
          }}
          placeholder={`Message ${otherName}`}
          disabled={sending}
          className="flex-1 h-11 bg-surface border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust disabled:opacity-60"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={sending || !body.trim()}
          className="h-11 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
        >
          {sending ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}
