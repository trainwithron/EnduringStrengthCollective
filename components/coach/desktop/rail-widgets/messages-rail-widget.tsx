"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { RailWidgetHeader, RailWidgetRow, RailWidgetDeeperLink, RailWidgetEmpty, RailWidgetLoading } from "./rail-widget-shell";

interface RecentMessage {
  otherId: string;
  otherName: string;
  body: string;
  createdAt: string;
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

// Hover rail widgets (hover_expand_rail_widgets_idea.md) — Messages icon.
// Same direct_messages table/columns the Messages page itself and the
// shell's own unread badge already query — most-recent message per
// distinct other party, same dedup idea as that page's buildConversations
// (simplified: this only needs the top few, not the full sorted list).
export function MessagesRailWidget({ groupId }: { groupId: string }) {
  const [messages, setMessages] = useState<RecentMessage[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from("direct_messages")
        .select("sender_id, recipient_id, body, created_at, sender:sender_id ( full_name ), recipient:recipient_id ( full_name )")
        .eq("group_id", groupId)
        .or(`sender_id.eq.${user.id},recipient_id.eq.${user.id}`)
        .order("created_at", { ascending: false })
        .limit(15);

      const seen = new Set<string>();
      const recent: RecentMessage[] = [];
      for (const m of (data ?? []) as any[]) {
        const otherId = m.sender_id === user.id ? m.recipient_id : m.sender_id;
        if (seen.has(otherId)) continue;
        seen.add(otherId);
        const otherName = (m.sender_id === user.id ? m.recipient : m.sender)?.full_name ?? "Client";
        recent.push({ otherId, otherName, body: m.body, createdAt: m.created_at });
        if (recent.length >= 3) break;
      }
      if (!cancelled) setMessages(recent);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  return (
    <div>
      <RailWidgetHeader title="Recent messages" />
      {messages === null ? (
        <RailWidgetLoading />
      ) : messages.length === 0 ? (
        <RailWidgetEmpty text="No messages yet." />
      ) : (
        <div>
          {messages.map((m) => (
            <RailWidgetRow
              key={m.otherId}
              primary={m.otherName}
              secondary={relativeTime(m.createdAt)}
              href={`/groups/${groupId}/messages/${m.otherId}`}
            />
          ))}
        </div>
      )}
      <RailWidgetDeeperLink href={`/groups/${groupId}/messages`} label="Open Messages" />
    </div>
  );
}
