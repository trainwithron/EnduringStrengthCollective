"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { confirmDialog } from "@/components/shared/confirm-dialog";

// What a coach does with a report: take the post or comment down (it is deleted for everyone), or leave it up and mark the report handled. Either way the report is marked handled only after the step really worked.
export function ReportedItemActions({ reportId, postId, commentId }: { reportId: string; postId: string | null; commentId: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noun = commentId ? "comment" : "post";

  async function markHandled(supabase: ReturnType<typeof createBrowserClient>) {
    const { error: handleError } = await supabase.rpc("handle_content_report", { p_report: reportId });
    if (handleError) throw handleError;
  }

  async function remove() {
    if (busy) return;
    if (!(await confirmDialog({ message: `Remove this ${noun} for everyone? This cannot be undone.`, confirmLabel: "Remove", cancelLabel: "Cancel", destructive: true }))) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = createBrowserClient();
      const { data, error: deleteError } = commentId
        ? await supabase.from("comments").delete().eq("id", commentId).select("id")
        : await supabase.from("posts").delete().eq("id", postId as string).select("id");
      if (deleteError || !data || data.length === 0) throw deleteError ?? new Error("nothing deleted");
      // Deleting a post also removes its reports with it; a comment's report is marked handled (it goes with the comment too, so a failure here is harmless).
      if (commentId) await markHandled(supabase).catch(() => undefined);
      router.refresh();
    } catch {
      setError(`That didn't work. The ${noun} was not removed. Try again.`);
    } finally {
      setBusy(false);
    }
  }

  async function dismiss() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await markHandled(createBrowserClient());
      router.refresh();
    } catch {
      setError("That didn't work. The report is still open. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 font-body text-xs">
      <button type="button" onClick={() => void remove()} disabled={busy} className="min-h-8 text-rust underline underline-offset-2 disabled:opacity-40">
        Remove this {noun}
      </button>
      <button type="button" onClick={() => void dismiss()} disabled={busy} className="min-h-8 text-steel underline underline-offset-2 disabled:opacity-40">
        Leave it up, mark handled
      </button>
      {error && (
        <span className="text-rust" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
