"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

export interface SupportMessageRow {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

export function SupportThread({
  requestId,
  subject,
  status,
  messages,
  viewerId,
  canManage,
}: {
  requestId: string;
  subject: string;
  status: "open" | "resolved";
  messages: SupportMessageRow[];
  viewerId: string;
  canManage: boolean;
}) {
  const [thread, setThread] = useState(messages);
  const [currentStatus, setCurrentStatus] = useState(status);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleReply() {
    const body = reply.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);

    const supabase = createBrowserClient();
    const { data, error: insertError } = await supabase
      .from("support_messages")
      .insert({ request_id: requestId, author_id: viewerId, body })
      .select("id, author_id, body, created_at")
      .single();

    if (insertError || !data) {
      setError(insertError?.message ?? "Couldn't send that — try again.");
      setSending(false);
      return;
    }

    setThread((prev) => [
      ...prev,
      { id: data.id, authorId: data.author_id, authorName: "You", body: data.body, createdAt: data.created_at },
    ]);
    setReply("");
    setSending(false);
  }

  async function handleToggleStatus() {
    const next = currentStatus === "open" ? "resolved" : "open";
    const supabase = createBrowserClient();
    const { error: updateError } = await supabase
      .from("support_requests")
      .update({ status: next, updated_at: new Date().toISOString() })
      .eq("id", requestId);
    if (!updateError) setCurrentStatus(next);
  }

  return (
    <div className="border border-steel/20 p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <h3 className="font-body font-medium text-sm">{subject}</h3>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`font-body text-[10px] uppercase tracking-wide px-2 h-5 flex items-center ${
              currentStatus === "open" ? "bg-rust/20 text-rust" : "bg-steel/20 text-steel"
            }`}
          >
            {currentStatus}
          </span>
          {canManage && (
            <button
              type="button"
              onClick={handleToggleStatus}
              className="font-body text-xs text-steel active:text-rust transition-colors"
            >
              {currentStatus === "open" ? "Mark resolved" : "Reopen"}
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2 mb-3">
        {thread.map((m) => (
          <div key={m.id} className={m.authorId === viewerId ? "text-right" : ""}>
            <p className="font-body text-[11px] text-steel">{m.authorName}</p>
            <p className="font-body text-sm inline-block bg-surface border border-steel/20 px-3 py-2 mt-0.5 max-w-[85%]">
              {m.body}
            </p>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleReply();
          }}
          placeholder="Reply…"
          className="flex-1 h-10 bg-surface border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
        />
        <button
          type="button"
          onClick={handleReply}
          disabled={sending || !reply.trim()}
          className="h-10 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
      {error && (
        <p className="font-body text-xs text-rust mt-1.5" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
