"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

// Reuses the same tap-to-check-off shape as the existing habit checklist
// (components/athlete/today-widget.tsx) — a coach's recommended action,
// not a recurring habit, but the same "one tap, immediate persist"
// interaction.
export function VideoCheckinActionItem({
  id,
  body,
  initialCompleted,
}: {
  id: string;
  body: string;
  initialCompleted: boolean;
}) {
  const [completed, setCompleted] = useState(initialCompleted);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    const next = !completed;
    const supabase = createBrowserClient();
    const { error } = await supabase
      .from("coach_video_checkin_action_items")
      .update({ completed: next })
      .eq("id", id);
    setBusy(false);
    if (!error) setCompleted(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className="flex items-center gap-2 text-left w-full disabled:opacity-60"
    >
      <span
        className={`w-4 h-4 shrink-0 border flex items-center justify-center ${
          completed ? "bg-rust border-rust" : "border-steel/40"
        }`}
      >
        {completed && <span className="text-graphite text-[10px] leading-none">✓</span>}
      </span>
      <span className={`font-body text-sm ${completed ? "text-steel line-through" : "text-chalk"}`}>{body}</span>
    </button>
  );
}
