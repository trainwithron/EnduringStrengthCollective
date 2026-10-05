"use client";

import { useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";
import { groupNotificationsByDay, timeAgo } from "@/lib/notification-days";

export interface CenterEntry {
  id: string;
  body: string;
  linkPath: string;
  createdAt: string;
  readAt: string | null;
  groupName: string | null;
}

// The full notification center: everything the viewer has been told, newest first under day headings, with unread marked. The bell in the
// header shows the latest few; this is the whole list.
export function NotificationList({ initial, timezone }: { initial: CenterEntry[]; timezone: string }) {
  const [items, setItems] = useState(initial);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [error, setError] = useState<string | null>(null);
  const unread = items.filter((n) => !n.readAt);
  const visible = filter === "unread" ? unread : items;
  const groups = groupNotificationsByDay(visible, timezone);

  async function markRead(ids: string[]) {
    if (ids.length === 0) return;
    const stamp = new Date().toISOString();
    const before = items;
    setItems((prev) => prev.map((n) => (ids.includes(n.id) ? { ...n, readAt: stamp } : n)));
    const supabase = createBrowserClient();
    const { error: updateError } = await supabase.from("notifications").update({ read_at: stamp }).in("id", ids);
    if (updateError) {
      setItems(before);
      setError("That didn't save. Check your connection and try again.");
    } else {
      setError(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex gap-2" role="group" aria-label="Show">
          {(["all", "unread"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={`font-body text-sm px-3 py-1.5 border ${filter === f ? "border-chalk text-chalk" : "border-steel/30 text-steel"}`}
            >
              {f === "all" ? "All" : `Unread${unread.length > 0 ? ` (${unread.length})` : ""}`}
            </button>
          ))}
        </div>
        {unread.length > 0 && (
          <button type="button" onClick={() => markRead(unread.map((n) => n.id))} className="font-body text-sm text-steel underline">
            Mark all read
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="font-body text-sm text-rust mb-3">
          {error}
        </p>
      )}

      {groups.length === 0 ? (
        <p className="font-body text-sm text-steel">{filter === "unread" ? "You're all caught up." : "Nothing yet. Replies, assignments and reminders will show up here."}</p>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.key} aria-label={g.label}>
              <h2 className="font-display uppercase text-xs tracking-wide text-steel mb-2">{g.label}</h2>
              <ul className="divide-y divide-steel/15 border border-steel/20">
                {g.items.map((n) => (
                  <li key={n.id}>
                    <Link href={n.linkPath} onClick={() => markRead([n.id])} className={`flex items-start gap-3 px-4 py-3 ${!n.readAt ? "bg-surface" : ""}`}>
                      <span aria-hidden="true" className={`mt-2 w-1.5 h-1.5 rounded-full shrink-0 ${!n.readAt ? "bg-chalk" : "bg-transparent"}`} />
                      <span className="min-w-0">
                        <span className={`block font-body text-sm ${!n.readAt ? "text-chalk" : "text-steel"}`}>{n.body}</span>
                        <span className="block font-body text-xs text-steel mt-0.5">
                          {n.groupName ? `${n.groupName} · ` : ""}
                          {timeAgo(n.createdAt)}
                          {!n.readAt && <span className="sr-only"> (unread)</span>}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
