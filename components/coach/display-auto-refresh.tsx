"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

// A wall-mounted TV/tablet has nobody to hit reload — this catches the
// date rolling over to a new day and any workout edits. The leaderboard
// below already updates live via its own Supabase Realtime subscription
// and doesn't need this.
export function DisplayAutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    const interval = setInterval(() => router.refresh(), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [router]);

  return null;
}
