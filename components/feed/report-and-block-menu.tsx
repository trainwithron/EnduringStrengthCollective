"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { confirmDialog } from "@/components/shared/confirm-dialog";
import { BLOCKED_EVENT, BLOCK_CONFIRM, REPORTED_THANKS, REPORT_REASON_MAX, firstNameOf } from "@/lib/content-moderation";

// A small "More" control on someone else's post or comment: Report it, or Block the person. Nothing is hidden or deleted by a report (the group's coaches look at it); a block hides that member's posts and comments from
// the person who blocked, nobody is told. Both say plainly whether they worked.
export function ReportAndBlockMenu({
  postId,
  commentId,
  authorId,
  authorName,
  onBlocked,
}: {
  postId?: string;
  commentId?: string;
  authorId: string;
  authorName: string;
  onBlocked: (authorId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const noun = commentId ? "comment" : "post";

  async function sendReport() {
    const text = reason.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    const { error: rpcError } = await createBrowserClient().rpc("report_content", { p_post: postId ?? null, p_comment: commentId ?? null, p_reason: text });
    setBusy(false);
    if (rpcError) {
      setError("That didn't send. Nothing was reported. Try again in a moment.");
      return;
    }
    setMessage(REPORTED_THANKS);
    setReporting(false);
    setReason("");
    setOpen(false);
  }

  async function block() {
    if (busy) return;
    if (!(await confirmDialog({ message: BLOCK_CONFIRM(firstNameOf(authorName)), confirmLabel: "Block", cancelLabel: "Cancel", destructive: true }))) return;
    setBusy(true);
    setError(null);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusy(false);
      setError("That didn't work. You were not signed in. Reload and try again.");
      return;
    }
    const { error: insertError } = await supabase.from("user_blocks").upsert({ blocker_id: user.id, blocked_id: authorId }, { onConflict: "blocker_id,blocked_id", ignoreDuplicates: true });
    setBusy(false);
    if (insertError) {
      setError("That didn't work. Nobody was blocked. Try again in a moment.");
      return;
    }
    onBlocked(authorId);
    // Tell every open list, so the member's posts leave the feed as well as the comments.
    window.dispatchEvent(new CustomEvent(BLOCKED_EVENT, { detail: authorId }));
  }

  if (message) return <span className="font-body text-xs text-steel">{message}</span>;

  return (
    <div className="font-body text-xs">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} aria-label={`More options for this ${noun}`} aria-expanded="false" className="min-h-8 px-1 text-steel underline underline-offset-2">
          More
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {!reporting && (
            <>
              <button type="button" onClick={() => setReporting(true)} className="min-h-8 text-steel underline underline-offset-2">
                Report this {noun}
              </button>
              <button type="button" onClick={() => void block()} disabled={busy} className="min-h-8 text-steel underline underline-offset-2 disabled:opacity-40">
                Block {firstNameOf(authorName)}
              </button>
              <button type="button" onClick={() => setOpen(false)} className="min-h-8 text-steel">
                Close
              </button>
            </>
          )}
          {reporting && (
            <div className="w-full space-y-1.5">
              <textarea
                aria-label={`Why are you reporting this ${noun}?`}
                value={reason}
                onChange={(e) => setReason(e.target.value.slice(0, REPORT_REASON_MAX))}
                rows={2}
                placeholder="Tell the coach what is wrong, in a sentence."
                className="w-full bg-graphite border border-steel/30 text-chalk px-2 py-1.5 text-sm"
              />
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => void sendReport()} disabled={busy || !reason.trim()} className="min-h-8 text-rust underline underline-offset-2 disabled:opacity-40">
                  Send report
                </button>
                <button type="button" onClick={() => setReporting(false)} className="min-h-8 text-steel">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {error && (
        <p className="text-rust mt-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
