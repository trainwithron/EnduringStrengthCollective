"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { generateKioskPin } from "@/lib/kiosk-pin";

interface RosterEntry {
  athleteId: string;
  fullName: string;
  kioskPin: string | null;
}

// hidden_by_default_config_design_principle.md — a PIN is a code every
// other athlete on the roster could in principle see over a coach's
// shoulder, so it stays masked until this specific row is tapped open,
// same "don't show it unless asked" discipline as every other
// reveal-on-demand control in this app.
export function KioskPinManager({ groupId, initialRoster }: { groupId: string; initialRoster: RosterEntry[] }) {
  const [roster, setRoster] = useState(initialRoster);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);

  function toggleReveal(athleteId: string) {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(athleteId)) next.delete(athleteId);
      else next.add(athleteId);
      return next;
    });
  }

  async function resetPin(athleteId: string) {
    setBusyId(athleteId);
    const newPin = generateKioskPin();
    const supabase = createBrowserClient();
    const { error } = await supabase
      .from("group_memberships")
      .update({ kiosk_pin: newPin })
      .eq("group_id", groupId)
      .eq("profile_id", athleteId);
    if (!error) {
      setRoster((prev) => prev.map((r) => (r.athleteId === athleteId ? { ...r, kioskPin: newPin } : r)));
      setRevealed((prev) => new Set(prev).add(athleteId));
    }
    setBusyId(null);
  }

  return (
    <div className="divide-y divide-steel/15 border border-steel/20">
      {roster.map((r) => (
        <div key={r.athleteId} className="flex items-center justify-between gap-4 px-4 py-3">
          <span className="font-body text-sm">{r.fullName}</span>
          <div className="flex items-center gap-3">
            {r.kioskPin ? (
              <button
                type="button"
                onClick={() => toggleReveal(r.athleteId)}
                className="font-display text-sm tracking-[0.2em] text-chalk w-16 text-center"
              >
                {revealed.has(r.athleteId) ? r.kioskPin : "••••"}
              </button>
            ) : (
              <span className="font-body text-xs text-steel">No PIN set</span>
            )}
            <button
              type="button"
              onClick={() => resetPin(r.athleteId)}
              disabled={busyId === r.athleteId}
              className="h-8 px-3 bg-surface border border-steel/30 font-body text-xs text-chalk disabled:opacity-40"
            >
              {busyId === r.athleteId ? "…" : r.kioskPin ? "Reset" : "Generate"}
            </button>
          </div>
        </div>
      ))}
      {roster.length === 0 && (
        <p className="font-body text-sm text-steel px-4 py-6 text-center">No athletes in this group yet.</p>
      )}
    </div>
  );
}
