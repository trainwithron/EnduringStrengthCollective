"use client";

import { useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";

export interface OrgNotification {
  id: string;
  type: string;
  body: string;
  linkPath: string;
  createdAt: string;
}

// overnight_comprehensive_polish_pass_sept19_20.md, finding #1 — a real
// bug, not a UX nitpick: org trainer-dispatch notifications (admin
// alerts, per-trainer cascade offers, question-reply alerts) are
// inserted with group_id: null since they're inherently org-level, not
// tied to any one client relationship — but the only other notification
// reader in the app (app/groups/[groupId]/page.tsx) filters by an exact
// group_id match, which can never match NULL. This is the org-level
// reader that closes that gap, on the one page that's already
// cross-group by design (/dashboard). Marking one read uses the
// notifications table's own read_at column, same real mechanism the
// group-scoped bell already relies on — no new dismissal table needed.
export function OrgNotificationsPanel({ initialNotifications }: { initialNotifications: OrgNotification[] }) {
  const [rows, setRows] = useState(initialNotifications);
  const [dismissingId, setDismissingId] = useState<string | null>(null);

  async function dismiss(id: string) {
    setDismissingId(id);
    setRows((prev) => prev.filter((n) => n.id !== id));
    const supabase = createBrowserClient();
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
    setDismissingId(null);
  }

  if (rows.length === 0) return null;

  return (
    <section className="mb-10 border border-rust/30 bg-rust/5 p-4">
      <h2 className="font-display uppercase text-sm tracking-wide text-rust mb-2">
        Organization Notifications
      </h2>
      <div className="space-y-2">
        {rows.map((n) => (
          <div key={n.id} className="flex items-start justify-between gap-3">
            <Link
              href={n.linkPath}
              onClick={() => dismiss(n.id)}
              className="min-w-0 flex-1 group"
            >
              <p className="font-body text-sm text-chalk group-active:text-rust">{n.body}</p>
            </Link>
            <button
              type="button"
              onClick={() => dismiss(n.id)}
              disabled={dismissingId === n.id}
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
