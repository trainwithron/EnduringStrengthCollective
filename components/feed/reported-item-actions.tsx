"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { confirmDialog } from "@/components/shared/confirm-dialog";

// What someone who handles reports does with one: take the post or comment down (it is removed for everyone; a comment's replies go with it, and the confirm says how many), or leave it up and mark the report handled.
// Both go through database functions that check the person may handle this report (never the person reported). A report is marked handled only after the step really worked.
export function ReportedItemActions({ reportId, isComment, contentGone }: { reportId: string; isComment: boolean; contentGone: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noun = isComment ? "comment" : "post";

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = createBrowserClient();
      let message = `Remove this ${noun} for everyone? This cannot be undone.`;
      if (isComment) {
        const { data: replies } = await supabase.rpc("reported_comment_reply_count", { p_report: reportId });
        const n = typeof replies === "number" ? replies : 0;
        message = n > 0 ? `Remove this comment for everyone? This also removes ${n} ${n === 1 ? "reply" : "replies"} to it. This cannot be undone.` : message;
      }
      setBusy(false);
      if (!(await confirmDialog({ message, confirmLabel: "Remove", cancelLabel: "Cancel", destructive: true }))) return;
      setBusy(true);
      const { error: removeError } = await supabase.rpc("remove_reported_content", { p_report: reportId });
      if (removeError) throw removeError;
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
      const { error: handleError } = await createBrowserClient().rpc("handle_content_report", { p_report: reportId });
      if (handleError) throw handleError;
      router.refresh();
    } catch {
      setError("That didn't work. The report is still open. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 font-body text-xs">
      {!contentGone && (
        <button type="button" onClick={() => void remove()} disabled={busy} className="min-h-8 text-rust underline underline-offset-2 disabled:opacity-40">
          Remove this {noun}
        </button>
      )}
      <button type="button" onClick={() => void dismiss()} disabled={busy} className="min-h-8 text-steel underline underline-offset-2 disabled:opacity-40">
        {contentGone ? "Mark handled" : "Leave it up, mark handled"}
      </button>
      {error && (
        <span className="text-rust" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
