"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { InboxConversation } from "@/lib/coach-inbox";

// Spotlight's Messages tile on a coach's phone (Ron, Oct 19: "I do want messages in the spotlight tab"): every conversation in the organization, newest first, with the last line and
// how many are unread. Tapping one opens the conversation. The same list as the Messages page (/api/messages/inbox, which marks nothing read).
export function SpotMessagesPanel({ groupId, onNavigated }: { groupId: string; onNavigated: () => void }) {
  const [conversations, setConversations] = useState<InboxConversation[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/messages/inbox?groupId=${encodeURIComponent(groupId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { conversations?: InboxConversation[] }) => {
        if (!cancelled) setConversations(data.conversations ?? []);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  if (failed) return <p className="font-body text-sm text-steel">Messages didn&apos;t load. Close Spotlight and open it again.</p>;
  if (conversations === null) return <p className="font-body text-sm text-steel">Loading…</p>;
  if (conversations.length === 0) return <p className="font-body text-sm text-steel">No messages yet.</p>;
  return (
    <ul className="divide-y divide-steel/15 border-y border-steel/15" data-spot-messages>
      {conversations.map((c) => (
        <li key={`${c.groupId}-${c.otherId}`}>
          <Link href={`/groups/${c.groupId}/messages/${c.otherId}`} onClick={onNavigated} className="flex items-center gap-3 py-3 min-h-11">
            <span className="min-w-0 flex-1">
              <span className={`block font-body text-sm truncate ${c.unreadCount > 0 ? "text-chalk font-semibold" : "text-chalk"}`}>{c.fullName}</span>
              <span className="block font-body text-xs text-steel truncate">{c.lastBody ?? "No messages yet"}</span>
            </span>
            {c.unreadCount > 0 && (
              <span className="shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-rust text-graphite font-body text-[11px] font-bold flex items-center justify-center" aria-label={`${c.unreadCount} unread`}>
                {c.unreadCount}
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
