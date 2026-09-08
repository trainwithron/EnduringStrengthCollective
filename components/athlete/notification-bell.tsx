"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { Bell } from "lucide-react";

export interface NotificationEntry {
  id: string;
  type: "comment" | "program_assigned" | "macros_assigned";
  body: string;
  linkPath: string;
  createdAt: string;
  readAt: string | null;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function NotificationBell({ initial }: { initial: NotificationEntry[] }) {
  const [items, setItems] = useState(initial);
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const unreadCount = items.filter((n) => !n.readAt).length;

  async function markRead(ids: string[]) {
    if (ids.length === 0) return;
    setItems((prev) =>
      prev.map((n) => (ids.includes(n.id) ? { ...n, readAt: new Date().toISOString() } : n))
    );
    const supabase = createBrowserClient();
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .in("id", ids);
  }

  function handleOpenNotification(n: NotificationEntry) {
    setOpen(false);
    markRead([n.id]);
    router.push(n.linkPath);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
        className="relative w-9 h-9 flex items-center justify-center text-chalk"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 flex items-center justify-center bg-rust text-graphite text-[10px] font-bold rounded-full leading-none">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-11 z-50 w-80 max-h-[70vh] overflow-y-auto bg-surface border border-steel/30 shadow-lg">
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-steel/15">
              <p className="font-display uppercase text-xs tracking-wide text-steel">
                Notifications
              </p>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => markRead(items.filter((n) => !n.readAt).map((n) => n.id))}
                  className="font-body text-[11px] text-rust"
                >
                  Mark all read
                </button>
              )}
            </div>

            {items.length === 0 ? (
              <p className="font-body text-xs text-steel px-3 py-4">Nothing yet.</p>
            ) : (
              <div className="divide-y divide-steel/15">
                {items.map((n) => (
                  <Link
                    key={n.id}
                    href={n.linkPath}
                    onClick={() => handleOpenNotification(n)}
                    className={`block px-3 py-2.5 ${!n.readAt ? "bg-rust/5" : ""}`}
                  >
                    <div className="flex items-start gap-2">
                      {!n.readAt && (
                        <span className="w-1.5 h-1.5 rounded-full bg-rust mt-1.5 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="font-body text-sm text-chalk">{n.body}</p>
                        <p className="font-body text-[11px] text-steel mt-0.5">
                          {timeAgo(n.createdAt)}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
