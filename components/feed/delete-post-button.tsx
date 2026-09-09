"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { Trash2 } from "lucide-react";

// Coach-only, per-post — "someone said something inappropriate, remove
// just that one" rather than clearing a whole channel. Comments cascade
// automatically (posts.id -> comments.post_id on delete cascade).
export function DeletePostButton({ postId }: { postId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: deleteError } = await supabase.from("posts").delete().eq("id", postId);
    setDeleting(false);
    if (deleteError) {
      setError("Couldn't delete — try again.");
      return;
    }
    setConfirming(false);
    router.refresh();
  }

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-2">
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="font-body text-xs text-rust font-medium disabled:opacity-40"
        >
          {deleting ? "Deleting…" : "Confirm delete"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={deleting}
          className="font-body text-xs text-steel disabled:opacity-40"
        >
          Cancel
        </button>
        {error && (
          <span className="font-body text-xs text-rust" role="alert">
            {error}
          </span>
        )}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="flex items-center gap-1 font-body text-xs text-steel active:text-rust transition-colors"
    >
      <Trash2 className="w-3.5 h-3.5" />
      Delete
    </button>
  );
}
