"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

// Fire-and-forget, no read-back — training_partner_reports has no
// authenticated select policy on purpose, reviewed directly via
// execute_sql rather than a moderation dashboard.
export function ReportUserButton({ reportedId }: { reportedId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    if (!reason.trim() || submitting) return;
    setSubmitting(true);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("training_partner_reports").insert({
        reporter_id: user.id,
        reported_id: reportedId,
        reason: reason.trim(),
      });
    }
    setSubmitting(false);
    setDone(true);
    setOpen(false);
  }

  if (done) {
    return <span className="font-body text-xs text-steel">Reported</span>;
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="font-body text-xs text-steel">
        Report
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="What's wrong?"
        className="h-8 w-40 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs focus:outline-none focus:border-rust"
      />
      <button
        type="button"
        onClick={submit}
        disabled={!reason.trim() || submitting}
        className="font-body text-xs text-rust disabled:opacity-40"
      >
        Submit
      </button>
    </div>
  );
}
