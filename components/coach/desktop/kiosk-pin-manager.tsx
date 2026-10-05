"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { generateKioskPin } from "@/lib/kiosk-pin";

interface RosterEntry {
  athleteId: string;
  fullName: string;
  hasPin: boolean;
}

// hidden_by_default_config_design_principle.md — a PIN is a code every
// other athlete on the roster could in principle see over a coach's
// shoulder, so it stays masked until this specific row is tapped open,
// same "don't show it unless asked" discipline as every other
// reveal-on-demand control in this app.
export function KioskPinManager({ groupId, initialRoster }: { groupId: string; initialRoster: RosterEntry[] }) {
  const [roster, setRoster] = useState(initialRoster);
  // A PIN is stored hashed and cannot be read back. The one you generate is shown here until you leave the page, so
  // you can tell the athlete; after that only "PIN set" shows and Reset makes a new one.
  const [justSet, setJustSet] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function resetPin(athleteId: string) {
    setBusyId(athleteId);
    const newPin = generateKioskPin();
    const supabase = createBrowserClient();
    setError(null);
    let { error: saveError } = await supabase.rpc("set_kiosk_pin", { p_group_id: groupId, p_athlete_id: athleteId, p_pin: newPin });
    if (saveError && /could not find the function|does not exist/i.test(saveError.message)) {
      // Hashed PINs are not on this database yet: the older plain column still works.
      ({ error: saveError } = await supabase
        .from("group_memberships")
        .update({ kiosk_pin: newPin })
        .eq("group_id", groupId)
        .eq("profile_id", athleteId));
    }
    if (saveError) {
      setError("Couldn't save that PIN. Try again.");
    } else {
      setRoster((prev) => prev.map((r) => (r.athleteId === athleteId ? { ...r, hasPin: true } : r)));
      setJustSet((prev) => ({ ...prev, [athleteId]: newPin }));
    }
    setBusyId(null);
  }

  return (
    <div>
      {error && (
        <p className="font-body text-xs text-rust mb-2" role="alert">
          {error}
        </p>
      )}
    <div className="divide-y divide-steel/15 border border-steel/20">
      {roster.map((r) => (
        <div key={r.athleteId} className="flex items-center justify-between gap-4 px-4 py-3">
          <span className="font-body text-sm">{r.fullName}</span>
          <div className="flex items-center gap-3">
            {justSet[r.athleteId] ? (
              <span className="font-display text-sm tracking-[0.2em] text-chalk w-16 text-center">{justSet[r.athleteId]}</span>
            ) : r.hasPin ? (
              <span className="font-body text-xs text-steel">PIN set</span>
            ) : (
              <span className="font-body text-xs text-steel">No PIN set</span>
            )}
            <button
              type="button"
              onClick={() => resetPin(r.athleteId)}
              disabled={busyId === r.athleteId}
              className="h-8 px-3 bg-surface border border-steel/30 font-body text-xs text-chalk disabled:opacity-40"
            >
              {busyId === r.athleteId ? "…" : r.hasPin ? "Reset" : "Generate"}
            </button>
          </div>
        </div>
      ))}
      {roster.length === 0 && (
        <p className="font-body text-sm text-steel px-4 py-6 text-center">No athletes in this group yet.</p>
      )}
    </div>
    </div>
  );
}
