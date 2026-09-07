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
  const router = useRouter();

  async function handleToggle() {
    setSubmitting(true);
    const supabase = createBrowserClient();
    await supabase
      .from("posts")
      .update({ pinned_at: pinned ? null : new Date().toISOString() })
      .eq("id", postId);
    setSubmitting(false);
    router.refresh();
  }

  return (
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
  );
}
