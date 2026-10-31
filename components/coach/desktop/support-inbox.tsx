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
  // Which request the right pane shows when the page area has room for two panes.
  const [selectedId, setSelectedId] = useState<string | null>(initialRequests[0]?.id ?? null);

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

    // Tell the platform admin right away (a push, and an email once a sender is set up). Best effort: the request is saved.
    void fetch("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "problem",
        message: `Support request: ${trimmedSubject}

${trimmedBody}`,
        pagePath: window.location.pathname,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
      }),
    }).catch(() => {});

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
    setSelectedId(request.id);
    setSubject("");
    setBody("");
    setComposing(false);
    setSending(false);
  }

  return (
    <div className="max-w-2xl @4xl:max-w-none space-y-6">
      {composing ? (
        <div className="border border-steel/20 p-4 space-y-3">
          <input aria-label="Subject"
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="w-full h-10 bg-surface border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
          />
          <textarea aria-label="What's going on?"
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

      {/* With room (@4xl), a two-pane inbox: the requests by subject on the left, the chosen one on the right. Narrower, every thread open, stacked, as before (layout audit #16).
          Each thread is rendered once either way, so a reply or a status change stays put when the window is resized. */}
      <div className="@4xl:grid @4xl:grid-cols-[18rem_minmax(0,1fr)] @4xl:gap-6 @4xl:items-start">
        {requests.length > 0 && (
          <ul className="hidden @4xl:block border border-steel/20 divide-y divide-steel/15" aria-label="Support requests">
            {requests.map((r) => {
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(r.id)}
                    aria-current={r.id === selectedId ? "true" : undefined}
                    className={`w-full text-left px-3 py-2.5 min-h-11 ${r.id === selectedId ? "bg-rust/10" : "hover:bg-surface"}`}
                  >
                    <span className={`block font-body text-sm truncate ${r.id === selectedId ? "text-rust" : "text-chalk"}`}>{r.subject}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="space-y-4 min-w-0">
          {requests.length === 0 && (
            <p className="font-body text-sm text-steel">No support requests yet.</p>
          )}
          {requests.map((r) => (
            <div key={r.id} className={r.id === selectedId ? "" : "@4xl:hidden"}>
              <SupportThread
                requestId={r.id}
                subject={r.subject}
                status={r.status}
                messages={r.messages}
                viewerId={coachId}
                canManage={true}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
