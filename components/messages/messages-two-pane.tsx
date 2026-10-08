"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { ThreadPane } from "@/components/messages/thread-pane";
import { filterConversations } from "@/lib/messages-list";
import { useInboxRefresh } from "@/components/messages/use-inbox-refresh";
import { MessagesSynopsisCard } from "@/components/messages/messages-synopsis-card";
import type { InboxConversation } from "@/lib/coach-inbox";

// "All messages": the conversation list on the left (unread first, searchable by name) and the open thread beside it. Picking a row opens that thread in place; the page does not
// navigate, so Back leaves the page as it should. The address keeps the selection (?with=) without adding history entries, so a refresh or a shared link opens the same thread.
export function MessagesTwoPane({
  conversations: initialConversations,
  incomplete: initialIncomplete = false,
  viewerId,
  viewerName,
  initialWithId,
  initialDraft = "",
  groupId,
}: {
  conversations: InboxConversation[];
  // True when some messages could not all be read, so the list may be a little off: the page says so.
  incomplete?: boolean;
  viewerId: string;
  viewerName: string;
  initialWithId: string | null;
  initialDraft?: string;
  groupId: string;
}) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(initialWithId);
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  // The list is refreshed every 45 seconds while the page is in front, so a message in another conversation shows up without a reload; a fresh list has the truth, so the "just opened" overrides go.
  const refreshed = useInboxRefresh(groupId, initialConversations, () => setCleared(new Set()));
  const conversations = refreshed.conversations;
  const incomplete = initialIncomplete || refreshed.incomplete;

  const visible = filterConversations(conversations, query);
  const selected = conversations.find((c) => c.otherId === selectedId) ?? null;

  const select = useCallback((otherId: string) => {
    setSelectedId(otherId);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("with", otherId);
      url.searchParams.delete("draft");
      window.history.replaceState(null, "", url.toString());
    } catch {
      // the address is a convenience; selecting still works without it
    }
  }, []);

  const onOpened = useCallback((otherId: string) => {
    setCleared((prev) => new Set(prev).add(otherId));
  }, []);

  return (
    <div className="flex border border-steel/20 h-[calc(100vh-14rem)] min-h-[420px]">
      <div className="w-72 shrink-0 border-r border-steel/20 flex flex-col">
        <MessagesSynopsisCard conversations={conversations} onPick={select} />
        <div className="p-2 border-b border-steel/15">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search clients"
            aria-label="Search conversations by client name"
            className="w-full h-10 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
          />
        </div>
        {incomplete && <p className="font-body text-xs text-steel px-3 py-2 border-b border-steel/15">Some older messages could not be loaded, so a last message or an unread count may be a little off. Reload to try again.</p>}
        <ul className="flex-1 overflow-y-auto" aria-label="Conversations">
          {visible.length === 0 && <li className="font-body text-sm text-steel px-3 py-3">{query ? "No client matches that." : "No athletes to message yet."}</li>}
          {visible.map((c) => {
            const unread = cleared.has(c.otherId) ? 0 : c.unreadCount;
            const active = c.otherId === selectedId;
            return (
              <li key={c.otherId}>
                <button
                  type="button"
                  onClick={() => select(c.otherId)}
                  aria-current={active ? "true" : undefined}
                  className={`w-full text-left flex items-center gap-3 px-3 min-h-14 py-2 border-b border-steel/10 ${active ? "bg-surface" : "active:bg-surface/60"}`}
                >
                  <span className="w-9 h-9 rounded-full bg-surface border border-steel/30 flex items-center justify-center shrink-0 font-display text-xs">
                    {c.fullName
                      .split(" ")
                      .map((p) => p[0])
                      .slice(0, 2)
                      .join("")
                      .toUpperCase()}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className={`block font-body text-sm truncate ${unread > 0 ? "font-semibold" : "font-medium"}`}>{c.fullName}</span>
                    <span className="block font-body text-xs text-steel truncate">{c.lastBody ?? "No messages yet"}</span>
                  </span>
                  {unread > 0 && (
                    <span className="h-5 min-w-[20px] px-1 rounded-full bg-rust text-graphite font-body text-xs font-bold flex items-center justify-center shrink-0">{unread > 9 ? "9+" : unread}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="flex-1 min-w-0 flex flex-col">
        {selected ? (
          <>
            <div className="px-5 py-3 border-b border-steel/15 flex items-baseline justify-between gap-3 shrink-0">
              <Link href={`/groups/${selected.groupId}/athletes/${selected.otherId}`} className="font-display uppercase text-lg tracking-wide text-chalk hover:text-rust">
                {selected.fullName}
              </Link>
              <span className="font-body text-xs text-steel">Open profile</span>
            </div>
            <div className="flex-1 min-h-0">
              <ThreadPane
                key={`${selected.groupId}:${selected.otherId}`}
                groupId={selected.groupId}
                viewerId={viewerId}
                viewerName={viewerName}
                otherId={selected.otherId}
                otherName={selected.fullName}
                initialDraft={selected.otherId === initialWithId ? initialDraft : ""}
                onOpened={onOpened}
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center px-6 text-center">
            <p className="font-body text-sm text-steel">Pick a conversation on the left.</p>
          </div>
        )}
      </div>
    </div>
  );
}
