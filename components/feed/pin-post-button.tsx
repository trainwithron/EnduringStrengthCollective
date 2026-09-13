"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { Pin } from "lucide-react";

export function PinPostButton({
  postId,
  pinned,
}: {
  postId: string;
  pinned: boolean;
}) {
  const [optimisticPinned, setOptimisticPinned] = useState(pinned);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleToggle() {
    setError(null);
    const nextPinned = !optimisticPinned;
    // Flip the pin state instantly; the write confirms in the background.
    setOptimisticPinned(nextPinned);
    const supabase = createBrowserClient();
    supabase
      .from("posts")
      .update({ pinned_at: nextPinned ? new Date().toISOString() : null })
      .eq("id", postId)
      .then(({ error: updateError }) => {
        if (updateError) {
          setOptimisticPinned(!nextPinned);
          setError("Couldn't pin — try again.");
          return;
        }
        router.refresh();
      });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={handleToggle}
        className={`flex items-center gap-1 font-body text-xs transition-colors ${
          optimisticPinned ? "text-rust" : "text-steel active:text-rust"
        }`}
      >
        <Pin className="w-3.5 h-3.5" fill={optimisticPinned ? "currentColor" : "none"} />
        {optimisticPinned ? "Unpin" : "Pin"}
      </button>
      {error && (
        <span className="font-body text-[11px] text-rust" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
