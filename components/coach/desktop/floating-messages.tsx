"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ThreadPane } from "@/components/messages/thread-pane";
import { INBOX_REFRESH_MS } from "@/components/messages/use-inbox-refresh";
import { panelSections, withPinnedClient } from "@/lib/messages-list";
import type { InboxConversation } from "@/lib/coach-inbox";

interface Notice {
  id: string;
  body: string;
  linkPath: string | null;
}

interface InboxPayload {
  conversations: InboxConversation[];
  incomplete?: boolean;
  notices: Notice[];
  viewerId: string;
  viewerName: string;
}

// The Messages tab of the floating panel: a quick view of who needs a reply. Mounted only while the tab is showing, so it loads nothing (and marks nothing read) while the panel is closed or
// on the Spot tab. The client the coach is looking at on a profile page is pinned to the top, labelled "Viewing", but not opened: one tap opens the thread in place, where the box at the
// bottom is the quick reply.
export function FloatingMessages({
  groupId,
  viewingClientId,
  openId,
  onOpenIdChange,
  onOpened,
}: {
  groupId: string;
  viewingClientId: string | null;
  // Which thread is open lives in the parent, so leaving the tab and coming back returns to it (the thread itself is unmounted while the tab is hidden, and loads again when shown).
  openId: string | null;
  onOpenIdChange: (id: string | null) => void;
  onOpened?: (otherId: string) => void;
}) {
  const [data, setData] = useState<InboxPayload | null>(null);
  const [failed, setFailed] = useState(false);
  const [cleared, setCleared] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    function load(first: boolean) {
      if (!first && document.visibilityState !== "visible") return;
      fetch(`/api/messages/inbox?groupId=${encodeURIComponent(groupId)}`, { cache: "no-store" })
        .then(async (res) => {
          if (!res.ok) throw new Error("load failed");
          return (await res.json()) as InboxPayload;
        })
        .then((d) => {
          if (cancelled) return;
          setData(d);
          setCleared(new Set());
        })
        .catch(() => {
          if (!cancelled && first) setFailed(true);
        });
    }
    load(true);
    // fresh again every 45 seconds while the tab is in front (read only; nothing is marked read here)
    const timer = setInterval(() => load(false), INBOX_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [groupId]);

  if (failed) return <p className="font-body text-sm text-rust px-4 py-3" role="alert">Couldn&apos;t load your messages. Close the panel and open it again.</p>;
  if (!data) return <p className="font-body text-sm text-steel px-4 py-3">Loading…</p>;

  const opened = data.conversations.find((c) => c.otherId === openId) ?? null;
  if (opened) {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="px-3 py-2 border-b border-steel/15 flex items-center gap-2 shrink-0">
          <button type="button" onClick={() => onOpenIdChange(null)} className="h-11 px-2 font-body text-xs text-steel active:text-rust">
            &larr; Back
          </button>
          <Link href={`/groups/${opened.groupId}/athletes/${opened.otherId}`} className="font-display uppercase text-sm tracking-wide text-chalk truncate">
            {opened.fullName}
          </Link>
        </div>
        <div className="flex-1 min-h-0">
          <ThreadPane
            key={`${opened.groupId}:${opened.otherId}`}
            groupId={opened.groupId}
            viewerId={data.viewerId}
            viewerName={data.viewerName}
            otherId={opened.otherId}
            otherName={opened.fullName}
            onOpened={(id) => {
              setCleared((prev) => new Set(prev).add(id));
              onOpened?.(id);
            }}
          />
        </div>
      </div>
    );
  }

  const adjusted = data.conversations.map((c) => (cleared.has(c.otherId) ? { ...c, unreadCount: 0 } : c));
  const sections = panelSections(adjusted);
  const { list: pinnedList, pinnedId } = withPinnedClient(adjusted, viewingClientId);
  const pinned = pinnedId ? pinnedList[0] : null;
  const row = (c: InboxConversation, label?: string) => (
    <li key={c.otherId}>
      <button type="button" onClick={() => onOpenIdChange(c.otherId)} className={`w-full text-left flex items-center gap-2 px-3 min-h-11 py-1.5 border-b border-steel/10 active:bg-surface/60 ${label ? "bg-rust/5" : ""}`}>
        <span className="flex-1 min-w-0">
          <span className="flex items-baseline gap-2">
            <span className={`font-body text-sm truncate ${c.unreadCount > 0 ? "font-semibold" : "font-medium"}`}>{c.fullName}</span>
            {label && <span className="font-body text-[10px] uppercase tracking-wide text-rust shrink-0">{label}</span>}
          </span>
          <span className="block font-body text-xs text-steel truncate">{c.lastBody ?? "No messages yet"}</span>
        </span>
        {c.unreadCount > 0 && <span className="h-5 min-w-[20px] px-1 rounded-full bg-rust text-graphite font-body text-xs font-bold flex items-center justify-center shrink-0">{c.unreadCount > 9 ? "9+" : c.unreadCount}</span>}
      </button>
    </li>
  );
  const section = (title: string, items: InboxConversation[]) =>
    items.length === 0 ? null : (
      <section key={title}>
        <h3 className="font-body text-[10px] uppercase tracking-wide text-steel px-3 pt-3 pb-1">{title}</h3>
        <ul>{items.map((c) => row(c))}</ul>
      </section>
    );

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      {pinned && (
        <section>
          <ul>{row(pinned, "Viewing")}</ul>
        </section>
      )}
      {data.notices.length > 0 && (
        <section>
          <h3 className="font-body text-[10px] uppercase tracking-wide text-steel px-3 pt-3 pb-1">Needs an answer</h3>
          <ul>
            {data.notices.map((n) => (
              <li key={n.id}>
                <Link href={n.linkPath ?? `/groups/${groupId}`} className="block px-3 min-h-11 py-2 border-b border-steel/10 font-body text-sm text-chalk active:bg-surface/60">
                  {n.body}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {section("Unread", sections.unread.filter((c) => c.otherId !== pinnedId))}
      {section("Waiting on your reply", sections.waiting.filter((c) => c.otherId !== pinnedId))}
      {section("Everyone else", sections.others.filter((c) => c.otherId !== pinnedId))}
      {data.incomplete && <p className="font-body text-xs text-steel px-3 pt-2">Some older messages could not be loaded, so a count may be a little off.</p>}
      {data.conversations.length === 0 && <p className="font-body text-sm text-steel px-3 py-3">No clients to message yet.</p>}
      <div className="px-3 py-3">
        <Link href={`/groups/${groupId}/messages`} className="font-body text-xs text-steel underline underline-offset-2">
          All messages
        </Link>
      </div>
    </div>
  );
}
