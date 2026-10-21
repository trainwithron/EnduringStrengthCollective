"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { NOTICE_KINDS } from "@/lib/coach-notice-kinds";

// Settings > Notifications for a coach: ONE plain on/off switch per KIND of notice, each with a one-line example. A switch controls both the push and the notice in the app. Saved the moment it is tapped, on the
// person's own profile (profiles.notices_off lists the kinds turned OFF). Important notices (invitations, an account closing, consent, support replies) are not on this list and always arrive.
export function NoticeSwitches({ profileId, initialOff, available, onOffChange }: { profileId: string; initialOff: string[]; available: boolean; onOffChange?: (off: string[]) => void }) {
  const [off, setOff] = useState<string[]>(initialOff);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (!available) return null;

  async function toggle(id: string) {
    if (busy) return;
    const previous = off;
    const next = previous.includes(id) ? previous.filter((x) => x !== id) : [...previous, id];
    setOff(next);
    setBusy(true);
    setNote(null);
    const { error } = await createBrowserClient().from("profiles").update({ notices_off: next }).eq("id", profileId);
    setBusy(false);
    if (error) {
      setOff(previous);
      setNote("Couldn't save that. It is back to what it was.");
      return;
    }
    onOffChange?.(next);
    setNote("Saved.");
  }

  return (
    <div className="pt-4 border-t border-steel/20 mt-4">
      <p className="font-body text-sm text-chalk">What you are told about</p>
      <p className="font-body text-xs text-steel mt-0.5">Each switch controls both the phone notification and the notice in the app. Account, invitation and consent messages always arrive.</p>
      <ul className="mt-3 space-y-2">
        {NOTICE_KINDS.map((k) => {
          const on = !off.includes(k.id);
          return (
            <li key={k.id}>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                disabled={busy}
                onClick={() => toggle(k.id)}
                className="w-full min-h-14 flex items-center gap-3 text-left border border-steel/20 px-3 py-2 disabled:opacity-60"
              >
                <span aria-hidden="true" className={`shrink-0 w-11 h-6 rounded-full relative transition-colors ${on ? "bg-rust" : "bg-steel/40"}`}>
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-chalk transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
                </span>
                <span className="min-w-0">
                  <span className="font-body text-sm text-chalk block">{k.label}</span>
                  <span className="font-body text-xs text-steel block">{k.example}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {note && (
        <p className="font-body text-xs text-chalk mt-2" role="status">
          {note}
        </p>
      )}
    </div>
  );
}
