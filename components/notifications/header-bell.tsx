"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { NotificationBell } from "@/components/athlete/notification-bell";

// The notification bell for any header that does not already have the viewer's id to hand: finds the signed-in person itself, then shows the
// same bell everyone else gets (latest few, unread badge, link to the full list). Renders nothing until it knows who is signed in.
export function HeaderNotificationBell({ placement = "below" }: { placement?: "below" | "above" }) {
  const [viewerId, setViewerId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    createBrowserClient()
      .auth.getUser()
      .then(({ data }) => {
        if (!cancelled) setViewerId(data.user?.id ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  if (!viewerId) return null;
  return <NotificationBell viewerId={viewerId} placement={placement} />;
}
