"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

// Settings: a client's own switch for the short reading offered while the rest timer runs. On by default for everyone; one tap turns it off. The choice belongs to the
// client alone (only they can read or change it), and it wins over everything: when it is off, Read never appears for them.
export function ReadDuringRestToggle({ athleteId, initialOn }: { athleteId: string; initialOn: boolean }) {
  const [on, setOn] = useState(initialOn);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !on;
    setOn(next);
    setSaving(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: saveError } = await supabase
      .from("read_settings")
      .upsert({ athlete_id: athleteId, faith_track: next, updated_at: new Date().toISOString() }, { onConflict: "athlete_id" });
    if (saveError) {
      setOn(!next);
      setError("That didn't save. The switch is back to what it was.");
    }
    setSaving(false);
  }

  return (
    <div>
      <label className="flex items-start gap-3 min-h-11 cursor-pointer">
        <input
          type="checkbox"
          checked={on}
          onChange={toggle}
          disabled={saving}
          aria-label="Read during rest"
          className="mt-1 h-5 w-5 accent-rust"
        />
        <span>
          <span className="block font-body text-sm text-chalk">Read during rest</span>
          <span className="block font-body text-xs text-steel mt-0.5">
            Shows a Read button beside the rest timer with a short King James passage. Only you can see this choice.
          </span>
        </span>
      </label>
      {error && (
        <p className="font-body text-xs text-rust mt-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
