"use client";

import { useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";

export interface NeedsReplyThread {
  postId: string;
  groupId: string;
  groupName: string;
  channel: string;
  authorName: string;
  snippet: string;
}

// The "Needs a reply" alert on the coach Home dashboard — each row deep
// links straight to the actual stale post (not just the group's feed) so
// there's no hunting for which post it meant, and can be dismissed
// without having to actually reply (findThreadsNeedingReply already
// self-clears on a real reply; this is the manual "I saw it" escape
// hatch, persisted so it doesn't come back until a newer reply lands).
export function NeedsReplyPanel({
  coachId,
  threads,
}: {
  coachId: string;
  threads: NeedsReplyThread[];
}) {
  const [rows, setRows] = useState(threads);
  const [dismissingId, setDismissingId] = useState<string | null>(null);

  async function dismiss(postId: string) {
    setDismissingId(postId);
    setRows((prev) => prev.filter((t) => t.postId !== postId));
    const supabase = createBrowserClient();
    const { error } = await supabase
      .from("coach_dismissed_reply_alerts")
      .upsert({ coach_id: coachId, post_id: postId, dismissed_at: new Date().toISOString() });
    if (error) {
      // Put it back if the write actually failed — a silently-lost
      // dismiss would just look like the alert never went away.
      setRows((prev) => [...prev, threads.find((t) => t.postId === postId)!]);
    }
    setDismissingId(null);
  }

  if (rows.length === 0) return null;

  return (
    <section className="mb-10 border border-rust/30 bg-rust/5 p-4">
      <h2 className="font-display uppercase text-sm tracking-wide text-rust mb-2">
        Needs a reply
      </h2>
      <div className="space-y-2">
        {rows.map((t) => (
          <div key={t.postId} className="flex items-start justify-between gap-3">
            <Link
              href={`/groups/${t.groupId}/feed?channel=${t.channel}&highlight=${t.postId}`}
              className="min-w-0 flex-1 group"
            >
              <p className="font-body text-sm text-chalk group-active:text-rust">
                <span className="font-medium">{t.authorName}</span> in {t.groupName}
              </p>
              <p className="font-body text-xs text-steel truncate mt-0.5">{t.snippet}</p>
            </Link>
            <button
              type="button"
              onClick={() => dismiss(t.postId)}
              disabled={dismissingId === t.postId}
              aria-label="Dismiss"
              className="shrink-0 text-steel active:text-rust transition-colors disabled:opacity-40"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
