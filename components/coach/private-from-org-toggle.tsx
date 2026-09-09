"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

// By default a client's full session log (sets, reps, weights, notes)
// stays visible up the org hierarchy — an org owner/admin overseeing
// their coaches, and a platform admin above that. This is the one
// deliberate exception, per client: a coach can mark a specific
// relationship private for a genuine reason (a sensitive circumstance, a
// personal connection) without weakening the default for everyone else.
export function PrivateFromOrgToggle({
  athleteId,
  groupId,
  initialValue,
}: {
  athleteId: string;
  groupId: string;
  initialValue: boolean;
}) {
  const [checked, setChecked] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleToggle(next: boolean) {
    setChecked(next);
    setSaving(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: updateError } = await supabase
      .from("group_memberships")
      .update({ private_from_org: next })
      .eq("group_id", groupId)
      .eq("profile_id", athleteId);
    setSaving(false);
    if (updateError) {
      setChecked(!next);
      setError("Couldn't save that — try again.");
    }
  }

  return (
    <div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => handleToggle(e.target.checked)}
          disabled={saving}
          className="w-4 h-4 accent-rust"
        />
        <span className="font-body text-sm">Keep this client&apos;s logs private from the org</span>
      </label>
      <p className="font-body text-[11px] text-steel mt-1 max-w-[50ch]">
        Off by default — an org owner/admin above you can normally see this
        client&apos;s full session history. Turning this on hides it from
        everyone except you and the client themselves.
      </p>
      {error && <p className="font-body text-xs text-rust mt-1">{error}</p>}
    </div>
  );
}
