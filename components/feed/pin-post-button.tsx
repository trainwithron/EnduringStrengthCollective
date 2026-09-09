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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleToggle() {
    setSubmitting(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: updateError } = await supabase
      .from("posts")
      .update({ pinned_at: pinned ? null : new Date().toISOString() })
      .eq("id", postId);
    setSubmitting(false);
    if (updateError) {
      setError("Couldn't pin — try again.");
      return;
    }
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={handleToggle}
        disabled={submitting}
        className={`flex items-center gap-1 font-body text-xs transition-colors disabled:opacity-40 ${
          pinned ? "text-rust" : "text-steel active:text-rust"
        }`}
      >
        <Pin className="w-3.5 h-3.5" fill={pinned ? "currentColor" : "none"} />
        {pinned ? "Unpin" : "Pin"}
      </button>
      {error && (
        <span className="font-body text-[11px] text-rust" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
