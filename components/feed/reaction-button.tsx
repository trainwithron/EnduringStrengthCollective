"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

export function ReactionButton({
  postId,
  groupId,
  initialCount,
  initialReacted,
  viewerId,
}: {
  postId: string;
  groupId: string;
  initialCount: number;
  initialReacted: boolean;
  viewerId: string | null;
}) {
  const [reacted, setReacted] = useState(initialReacted);
  const [count, setCount] = useState(initialCount);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (!viewerId || pending) return;
    setPending(true);
    setError(null);
    const supabase = createBrowserClient();

    // Optimistic update.
    const nextReacted = !reacted;
    setReacted(nextReacted);
    setCount((c) => (nextReacted ? c + 1 : Math.max(0, c - 1)));

    // Wrapped in try/finally so a thrown network error (not just a
    // Supabase {error} response) can never leave `pending` stuck true —
    // that would permanently disable this exact button until reload.
    try {
      if (nextReacted) {
        const { error: reqError } = await supabase
          .from("reactions")
          .insert({ post_id: postId, group_id: groupId, profile_id: viewerId, reaction_type: "fist_bump" });
        if (reqError) throw reqError;
      } else {
        const { error: reqError } = await supabase
          .from("reactions")
          .delete()
          .eq("post_id", postId)
          .eq("profile_id", viewerId)
          .eq("reaction_type", "fist_bump");
        if (reqError) throw reqError;
      }
    } catch {
      setReacted(!nextReacted);
      setCount((c) => (nextReacted ? Math.max(0, c - 1) : c + 1));
      setError("Couldn't save — check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
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
      {error && (
        <p className="font-body text-[11px] text-rust mt-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
