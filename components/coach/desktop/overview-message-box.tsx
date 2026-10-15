"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { DirectMessageThread } from "@/components/messages/direct-message-thread";
import { loadDirectThread, type ThreadMessage } from "@/lib/direct-thread";

export interface PreviewMessage {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
}

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// The coach's conversation with one client, small, on the client's Overview: the last few messages, how many are new, and a reply field. Loading the profile does NOT mark anything read (the page
// only peeks at the latest messages); the moment the coach taps the reply field or See full conversation the real thread opens, and that is when what the client sent counts as seen.
export function OverviewMessageBox({
  groupId,
  viewerId,
  viewerName,
  athleteId,
  clientName,
  preview,
  unread,
  initialOpen = false,
  initialDraft = "",
}: {
  groupId: string;
  viewerId: string;
  viewerName: string;
  athleteId: string;
  clientName: string;
  preview: PreviewMessage[];
  unread: number;
  initialOpen?: boolean;
  initialDraft?: string;
}) {
  const [mode, setMode] = useState<"closed" | "open" | "full">(initialOpen ? "open" : "closed");
  const [messages, setMessages] = useState<ThreadMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const first = clientName.trim().split(/\s+/)[0] || "Client";

  useEffect(() => {
    if (mode === "closed" || messages !== null) return;
    let cancelled = false;
    void loadDirectThread(createBrowserClient(), { groupId, viewerId, otherId: athleteId })
      .then((rows) => {
        if (!cancelled) setMessages(rows);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load the conversation. Try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [mode, messages, groupId, viewerId, athleteId]);

  return (
    <section aria-labelledby={`overview-messages-${athleteId}`} className="border border-steel/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id={`overview-messages-${athleteId}`} className="font-display uppercase text-sm tracking-wide text-steel">
          Messages
        </h2>
        {unread > 0 && mode === "closed" && <span className="font-body text-xs bg-rust text-graphite px-2 py-0.5">{unread} new</span>}
      </div>

      {mode === "closed" ? (
        <>
          {preview.length === 0 ? (
            <p className="font-body text-sm text-steel mt-2">No messages yet.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {preview.map((m) => (
                <li key={m.id} className="font-body text-sm">
                  <span className="text-xs text-steel">
                    {m.sender_id === viewerId ? "You" : first} · {when(m.created_at)}
                  </span>
                  <p className="text-chalk line-clamp-2">{m.body}</p>
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={() => setMode("open")} className="mt-3 w-full min-h-11 text-left px-3 bg-graphite border border-steel/30 font-body text-sm text-steel">
            Write a reply…
          </button>
          <button type="button" onClick={() => setMode("full")} className="mt-1 min-h-11 font-body text-xs text-rust underline underline-offset-2">
            See full conversation
          </button>
        </>
      ) : messages === null ? (
        <p className="font-body text-sm text-steel mt-2" role={error ? "alert" : "status"}>
          {error ?? "Loading…"}
        </p>
      ) : (
        <>
          <div className={`mt-2 border border-steel/20 ${mode === "full" ? "h-[70vh]" : "h-[340px]"}`}>
            <DirectMessageThread groupId={groupId} viewerId={viewerId} viewerName={viewerName} otherId={athleteId} otherName={clientName} initialMessages={messages} initialDraft={initialDraft} />
          </div>
          <button type="button" onClick={() => setMode(mode === "full" ? "open" : "full")} className="mt-1 min-h-11 font-body text-xs text-rust underline underline-offset-2">
            {mode === "full" ? "Show less" : "See full conversation"}
          </button>
        </>
      )}
    </section>
  );
}
