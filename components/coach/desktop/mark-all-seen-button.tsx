"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

export const CLEAR_DOTS_LABEL = "Clear new-activity dots";

// A single escape hatch for every "unseen activity" dot on Home at
// once — without it, a coach can only clear a dot by opening that
// specific group's Feed/Clients/Dashboard, which means chasing down
// whichever card lit up instead of just clearing the board. Same
// coach_view_state table and (coach_id, group_id) upsert key
// CoachDesktopShell already uses per-group, just applied to every group
// in one action.
// It says what it clears (audit, Nov 21: the old label, Mark all as seen, read like marking messages read), shows "Clearing…" while it works, "Done" once the dots are gone, and the problem in plain words
// if the save did not go through, and it is ready to press again afterwards (it used to stay greyed out until the page reloaded).
export function MarkAllSeenButton({ groupIds }: { groupIds: string[] }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "done" | "failed">("idle");

  useEffect(() => {
    if (state !== "done") return;
    const t = setTimeout(() => setState("idle"), 3000);
    return () => clearTimeout(t);
  }, [state]);

  async function handleClick() {
    if (state === "busy" || groupIds.length === 0) return;
    setState("busy");
    try {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setState("failed");
        return;
      }
      const nowIso = new Date().toISOString();
      const { error } = await supabase.from("coach_view_state").upsert(
        groupIds.map((groupId) => ({
          coach_id: user.id,
          group_id: groupId,
          feed_seen_at: nowIso,
          clients_seen_at: nowIso,
        })),
        { onConflict: "coach_id,group_id" }
      );
      if (error) {
        setState("failed");
        return;
      }
      router.refresh();
      setState("done");
    } catch {
      setState("failed");
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={state === "busy" || groupIds.length === 0}
        // a small link, not one of Home's main buttons (clutter audit DK22, Nov 21)
        className="min-h-11 font-body text-xs text-steel underline underline-offset-2 hover:text-chalk active:text-rust-ink transition-colors disabled:opacity-40"
      >
        {state === "busy" ? "Clearing…" : CLEAR_DOTS_LABEL}
      </button>
      {state === "done" && (
        <span className="font-body text-xs text-positive" role="status">
          Done
        </span>
      )}
      {state === "failed" && (
        <span className="font-body text-xs text-rust-ink" role="alert">
          Couldn&apos;t clear them. Check your connection and try again.
        </span>
      )}
    </span>
  );
}
