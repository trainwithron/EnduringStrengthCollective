"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

// The one place a group is made a team sport (or put back): groups.team_mode. A team-sport group gets the short team menu (Athletes, Team calendar, Attendance, Depth chart, Team feed, Messages, Team performance), says
// "Athletes" instead of "Clients", and has no Business area. The menus read this switch when the page loads, so the page reloads once it is saved.
export function TeamSportToggle({ groupId, initialEnabled }: { groupId: string; initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !enabled;
    setEnabled(next);
    setSaving(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: saveError } = await supabase.from("groups").update({ team_mode: next }).eq("id", groupId);
    if (saveError) {
      // Put the switch back so it shows what is really saved.
      setEnabled(!next);
      setError("That didn't save. The switch is back to what it was.");
      setSaving(false);
      return;
    }
    // The menus were built for the old setting: load the page again so they match.
    window.location.reload();
  }

  return (
    <div className="py-1">
      <label className="flex items-center justify-between gap-3">
        <span className="font-body text-sm text-chalk">
          This group is a team sport
          <span className="block font-body text-xs text-steel mt-0.5">Short team menu with the depth chart, team calendar and attendance, &ldquo;Athletes&rdquo; instead of &ldquo;Clients&rdquo;, and no Business area.</span>
        </span>
        <input type="checkbox" checked={enabled} onChange={toggle} disabled={saving} aria-label="This group is a team sport" className="w-5 h-5 shrink-0 accent-rust" />
      </label>
      {error && (
        <p className="font-body text-xs text-rust mt-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
