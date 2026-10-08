"use client";

import { useEffect, useState } from "react";
import { DirectMessageThread } from "@/components/messages/direct-message-thread";

interface ThreadMessage {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
}

// One conversation opened in place (the All messages page and the floating panel). It loads the thread when it is shown and not before, because loading a thread is the "seen it" moment
// (what the client sent is marked read): a pane that is closed, or on another tab, never mounts this, so nothing is marked read unseen. Switching to another client remounts it (key).
export function ThreadPane({
  groupId,
  viewerId,
  viewerName,
  otherId,
  otherName,
  initialDraft = "",
  onOpened,
}: {
  groupId: string;
  viewerId: string;
  viewerName: string;
  otherId: string;
  otherName: string;
  initialDraft?: string;
  // Called once the thread has loaded (and so been marked read): the list can clear that client's unread count.
  onOpened?: (otherId: string) => void;
}) {
  const [messages, setMessages] = useState<ThreadMessage[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setMessages(null);
    setFailed(false);
    fetch("/api/messages/thread", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ groupId, otherId }), cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error("load failed");
        return (await res.json()) as { messages: ThreadMessage[] };
      })
      .then((data) => {
        if (cancelled) return;
        setMessages(data.messages);
        onOpened?.(otherId);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // onOpened is read when the load finishes; a parent that passes a new function each render must not reload the thread
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, otherId]);

  if (failed) {
    return <p className="font-body text-sm text-rust px-5 py-4" role="alert">Couldn&apos;t open this conversation. Check your connection and pick it again.</p>;
  }
  if (!messages) {
    return <p className="font-body text-sm text-steel px-5 py-4">Opening…</p>;
  }
  return (
    <DirectMessageThread
      key={`${groupId}:${otherId}`}
      groupId={groupId}
      viewerId={viewerId}
      viewerName={viewerName}
      otherId={otherId}
      otherName={otherName}
      initialMessages={messages}
      initialDraft={initialDraft}
    />
  );
}
