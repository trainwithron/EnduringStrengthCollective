"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { SupportThread, type SupportMessageRow } from "./support-thread";

export interface SupportRequestRow {
  id: string;
  subject: string;
  status: "open" | "resolved";
  messages: SupportMessageRow[];
}

export function SupportInbox({
  organizationId,
  coachId,
  initialRequests,
}: {
  organizationId: string;
  coachId: string;
  initialRequests: SupportRequestRow[];
}) {
  const [requests, setRequests] = useState(initialRequests);
  const [composing, setComposing] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    const trimmedSubject = subject.trim();
    const trimmedBody = body.trim();
    if (!trimmedSubject || !trimmedBody || sending) return;
    setSending(true);
    setError(null);

    const supabase = createBrowserClient();
    const { data: request, error: requestError } = await supabase
      .from("support_requests")
      .insert({ organization_id: organizationId, coach_id: coachId, subject: trimmedSubject })
      .select("id, subject, status")
      .single();

    if (requestError || !request) {
      setError(requestError?.message ?? "Couldn't send that — try again.");
      setSending(false);
      return;
    }

    const { data: message, error: messageError } = await supabase
      .from("support_messages")
      .insert({ request_id: request.id, author_id: coachId, body: trimmedBody })
      .select("id, author_id, body, created_at")
      .single();

    if (messageError || !message) {
      setError(messageError?.message ?? "Couldn't send that — try again.");
      setSending(false);
      return;
    }

    setRequests((prev) => [
      {
        id: request.id,
        subject: request.subject,
        status: request.status,
        messages: [
          {
            id: message.id,
            authorId: message.author_id,
            authorName: "You",
            body: message.body,
            createdAt: message.created_at,
          },
        ],
      },
      ...prev,
    ]);
    setSubject("");
    setBody("");
    setComposing(false);
    setSending(false);
  }

  return (
    <div className="max-w-2xl space-y-6">
      {composing ? (
        <div className="border border-steel/20 p-4 space-y-3">
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="w-full h-10 bg-surface border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What's going on?"
            rows={4}
            className="w-full bg-surface border border-steel/30 text-chalk px-3 py-2 font-body text-sm focus:outline-none focus:border-rust"
          />
          {error && (
            <p className="font-body text-xs text-rust" role="alert">
              {error}
            </p>
          )}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={sending || !subject.trim() || !body.trim()}
              className="h-10 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
            >
              {sending ? "Sending…" : "Send"}
            </button>
            <button
              type="button"
              onClick={() => setComposing(false)}
              className="font-body text-xs text-steel"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setComposing(true)}
          className="h-11 px-4 bg-rust text-graphite font-display uppercase text-sm font-bold"
        >
          New support request
        </button>
      )}

      <div className="space-y-4">
        {requests.length === 0 && (
          <p className="font-body text-sm text-steel">No support requests yet.</p>
        )}
        {requests.map((r) => (
          <SupportThread
            key={r.id}
            requestId={r.id}
            subject={r.subject}
            status={r.status}
            messages={r.messages}
            viewerId={coachId}
            canManage={true}
          />
        ))}
      </div>
    </div>
  );
}
