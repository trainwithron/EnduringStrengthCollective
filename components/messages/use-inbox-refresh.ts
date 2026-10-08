"use client";

import { useEffect, useState } from "react";
import type { InboxConversation } from "@/lib/coach-inbox";

export const INBOX_REFRESH_MS = 45_000;

// Keeps a conversation list fresh while the page is in front: asks the (read-only) inbox route again every 45 seconds, so a message in another conversation shows up without a reload. It does
// nothing while the tab is in the background, and the route marks nothing read. `onRefreshed` lets the caller drop its "just opened" overrides, since the fresh list has the truth.
export function useInboxRefresh(groupId: string, initial: InboxConversation[], onRefreshed?: () => void): { conversations: InboxConversation[]; incomplete: boolean } {
  const [conversations, setConversations] = useState<InboxConversation[]>(initial);
  const [incomplete, setIncomplete] = useState(false);

  useEffect(() => {
    let stopped = false;
    async function refresh() {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/messages/inbox?groupId=${encodeURIComponent(groupId)}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { conversations: InboxConversation[]; incomplete?: boolean };
        if (stopped) return;
        setConversations(data.conversations);
        setIncomplete(!!data.incomplete);
        onRefreshed?.();
      } catch {
        // a missed refresh just means the list is a little behind until the next one
      }
    }
    const timer = setInterval(refresh, INBOX_REFRESH_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
    // onRefreshed is read when a refresh lands; a parent passing a new function each render must not restart the timer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  return { conversations, incomplete };
}
