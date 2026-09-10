"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

// A single escape hatch for every "unseen activity" dot on Home at
// once — without it, a coach can only clear a dot by opening that
// specific group's Feed/Clients/Dashboard, which means chasing down
// whichever card lit up instead of just clearing the board. Same
// coach_view_state table and (coach_id, group_id) upsert key
// CoachDesktopShell already uses per-group, just applied to every group
// in one action.
export function MarkAllSeenButton({ groupIds }: { groupIds: string[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    if (busy || groupIds.length === 0) return;
    setBusy(true);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusy(false);
      return;
    }

    const nowIso = new Date().toISOString();
    await supabase.from("coach_view_state").upsert(
      groupIds.map((groupId) => ({
        coach_id: user.id,
        group_id: groupId,
        feed_seen_at: nowIso,
        clients_seen_at: nowIso,
      })),
      { onConflict: "coach_id,group_id" }
    );

    setBusy(false);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy || groupIds.length === 0}
      className="font-body text-xs text-steel active:text-rust transition-colors disabled:opacity-40"
    >
      {busy ? "Clearing…" : "Mark all as seen"}
    </button>
  );
}
