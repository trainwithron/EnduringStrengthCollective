"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

export function ReactionButton({
  postId,
  initialCount,
  initialReacted,
  viewerId,
}: {
  postId: string;
  initialCount: number;
  initialReacted: boolean;
  viewerId: string | null;
}) {
  const [reacted, setReacted] = useState(initialReacted);
  const [count, setCount] = useState(initialCount);
  const [pending, setPending] = useState(false);

  async function toggle() {
    if (!viewerId || pending) return;
    setPending(true);
    const supabase = createBrowserClient();

    // Optimistic update.
    const nextReacted = !reacted;
    setReacted(nextReacted);
    setCount((c) => (nextReacted ? c + 1 : Math.max(0, c - 1)));

    if (nextReacted) {
      const { error } = await supabase
        .from("reactions")
        .insert({ post_id: postId, profile_id: viewerId, reaction_type: "fist_bump" });
      if (error) {
        setReacted(false);
        setCount((c) => Math.max(0, c - 1));
      }
    } else {
      const { error } = await supabase
        .from("reactions")
        .delete()
        .eq("post_id", postId)
        .eq("profile_id", viewerId)
        .eq("reaction_type", "fist_bump");
      if (error) {
        setReacted(true);
        setCount((c) => c + 1);
      }
    }
    setPending(false);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={`flex items-center gap-1.5 h-9 px-3 border transition-colors ${
        reacted
          ? "border-rust text-rust bg-rust/10"
          : "border-steel/30 text-steel active:border-rust active:text-rust"
      }`}
    >
      <span aria-hidden="true">👊</span>
      <span className="font-body text-sm tabular-nums">{count}</span>
    </button>
  );
}
