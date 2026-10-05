"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { Bell } from "lucide-react";
import { timeAgo } from "@/lib/notification-days";

export interface NotificationEntry {
  id: string;
  type: string;
  body: string;
  linkPath: string;
  createdAt: string;
  readAt: string | null;
}

// One bell for everyone (coach, client, trainer), on every screen that has a header. With `initial` it starts from what the page already
// fetched; without it, it loads the viewer's latest notifications itself, so any header can mount it with just the viewer's id.
export function NotificationBell({
  initial,
  viewerId,
  placement = "below",
}: {
  initial?: NotificationEntry[];
  viewerId: string;
  // "above" opens the list upward from a bell at the bottom of a sidebar.
  placement?: "below" | "above";
}) {
  const [items, setItems] = useState<NotificationEntry[]>(initial ?? []);
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (initial) return;
    let cancelled = false;
    const supabase = createBrowserClient();
    supabase
      .from("notifications")
      .select("id, type, body, link_path, read_at, created_at")
      .eq("profile_id", viewerId)
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data }) => {
        if (cancelled || !data) return;
        setItems(
          data.map((n: any) => ({ id: n.id, type: n.type, body: n.body, linkPath: n.link_path ?? "/", createdAt: n.created_at, readAt: n.read_at }))
        );
      });
    return () => {
      cancelled = true;
    };
  }, [initial, viewerId]);

  useEffect(() => {
    // This was a one-shot server fetch with no live update at all — a
    // mention or reply landing while the app was open never touched the
    // badge count until a full reload. Real-time INSERT only (an update
    // is always this same viewer marking their own row read, already
    // reflected optimistically by markRead below).
    const supabase = createBrowserClient();
    const channel = supabase
      .channel(`notifications:${viewerId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `profile_id=eq.${viewerId}` },
        (payload) => {
          const n = payload.new as any;
          setItems((prev) => [
            {
              id: n.id,
              type: n.type,
              body: n.body,
              linkPath: n.link_path,
              createdAt: n.created_at,
              readAt: n.read_at,
            },
            ...prev,
          ]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [viewerId]);

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
          <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 flex items-center justify-center bg-rust text-graphite text-xs font-bold rounded-full leading-none">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className={`absolute z-50 w-80 max-w-[85vw] max-h-[70vh] overflow-y-auto bg-surface border border-steel/30 shadow-lg ${placement === "above" ? "bottom-11 left-0" : "right-0 top-11"}`}>
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-steel/15">
              <p className="font-display uppercase text-xs tracking-wide text-steel">
                Notifications
              </p>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => markRead(items.filter((n) => !n.readAt).map((n) => n.id))}
                  className="font-body text-xs text-rust"
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
                        <p className="font-body text-xs text-steel mt-0.5">
                          {timeAgo(n.createdAt)}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="block px-3 py-2.5 border-t border-steel/15 font-body text-xs text-steel text-center"
            >
              See all notifications
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
