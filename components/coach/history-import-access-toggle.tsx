"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

// Locked design #2 (coach_onboarding_history_ingestion_scoping_sept19.md):
// a coach can grant a client a one-time link into the same uploader UI,
// if it's easier for the client to fill in their own history than the
// coach relaying it. Backed by a plain boolean on the coach's own
// group_memberships row for this client — no token/expiry system, no new
// RLS (memberships_update_coach already lets a coach update any
// membership row in their own group).
export function HistoryImportAccessToggle({
  groupId,
  athleteId,
  athleteName,
  initialEnabled,
}: {
  groupId: string;
  athleteId: string;
  athleteName: string;
  initialEnabled: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);

  async function toggle() {
    setSaving(true);
    const next = !enabled;
    setEnabled(next);
    const supabase = createBrowserClient();
    await supabase
      .from("group_memberships")
      .update({ history_import_enabled: next })
      .eq("group_id", groupId)
      .eq("profile_id", athleteId);
    setSaving(false);
  }

  return (
    <div className="border border-steel/20 bg-surface/40 p-4 max-w-2xl">
      <label className="flex items-start gap-3 cursor-pointer">
        <input type="checkbox" checked={enabled} onChange={toggle} disabled={saving} className="mt-1" />
        <span className="font-body text-sm text-chalk">
          Let {athleteName} enter their own history
          <span className="block font-body text-xs text-steel mt-0.5">
            Turns on the same uploader from {athleteName}&apos;s own Settings page — useful if it&apos;s easier for
            them to fill in their own past sessions than relaying it to you.
          </span>
        </span>
      </label>
    </div>
  );
}
