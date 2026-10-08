"use client";

import { useEffect, useRef, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

// A short King James reading shown while the rest timer runs. The passage is chosen on the server (one per person per day, or the coach's choice for the day) and
// handed in as plain text, so this works offline and costs nothing per use. The first time it opens, a one-line note says what it is and offers a one-tap off switch.
export function ReadSlot({
  athleteId,
  reference,
  text,
  noteSeen,
  onClose,
  onTurnedOff,
}: {
  athleteId: string;
  reference: string;
  text: string;
  noteSeen: boolean;
  onClose: () => void;
  onTurnedOff: () => void;
}) {
  const [showNote, setShowNote] = useState(!noteSeen);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const recordedRef = useRef(false);

  // The note is shown once: record that it was seen the first time the panel opens (best effort, never blocks the reading).
  useEffect(() => {
    if (noteSeen || recordedRef.current) return;
    recordedRef.current = true;
    const supabase = createBrowserClient();
    void supabase
      .from("read_settings")
      .upsert({ athlete_id: athleteId, note_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "athlete_id" })
      .then(() => undefined);
  }, [noteSeen, athleteId]);

  async function turnOff() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const supabase = createBrowserClient();
    const { error } = await supabase
      .from("read_settings")
      .upsert({ athlete_id: athleteId, faith_track: false, updated_at: new Date().toISOString() }, { onConflict: "athlete_id" });
    setBusy(false);
    if (error) {
      setFailed(true);
      return;
    }
    onTurnedOff();
  }

  return (
    <div className="mt-3 border border-steel/30 bg-surface p-4" data-testid="read-slot">
      {showNote && (
        <div className="mb-3 flex items-start justify-between gap-3 border-b border-steel/20 pb-3">
          <p className="font-body text-xs text-steel">A short Bible passage (King James) to read while you rest. Turn it off any time.</p>
          <button
            type="button"
            onClick={() => setShowNote(false)}
            aria-label="Dismiss note"
            className="min-h-[44px] min-w-[44px] -mt-3 -mr-3 flex items-center justify-center font-body text-xs text-steel"
          >
            ✕
          </button>
        </div>
      )}
      <p className="font-body text-sm text-chalk leading-relaxed">{text}</p>
      <p className="font-display text-sm text-rust mt-2 tracking-wide">{reference} (KJV)</p>
      <div className="flex items-center gap-3 mt-3">
        <button type="button" onClick={onClose} className="min-h-[44px] px-4 border border-steel/30 text-steel font-body text-xs">
          Close
        </button>
        <button type="button" onClick={turnOff} disabled={busy} className="min-h-[44px] px-3 font-body text-xs text-steel underline disabled:opacity-40">
          {busy ? "Turning off…" : "Turn this off"}
        </button>
        {failed && <span className="font-body text-xs text-rust">Could not save. Try again.</span>}
      </div>
    </div>
  );
}
