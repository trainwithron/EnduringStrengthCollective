"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

export interface TrainingPartnerProfileState {
  visible: boolean;
  locationText: string;
  lookingFor: string;
}

// Self-reported, athlete-owned, one row per athlete — same blur-persist
// convention as ProfileDetailsEditor. Toggling `visible` persists
// immediately (a checkbox has no natural "blur"); text fields persist
// on blur.
export function TrainingPartnerProfileEditor({
  athleteId,
  initial,
}: {
  athleteId: string;
  initial: TrainingPartnerProfileState;
}) {
  const [state, setState] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function persist(next: TrainingPartnerProfileState) {
    setSaving(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: upsertError } = await supabase.from("training_partner_profiles").upsert({
      athlete_id: athleteId,
      visible: next.visible,
      location_text: next.locationText || null,
      looking_for: next.lookingFor || null,
      updated_at: new Date().toISOString(),
    });
    if (upsertError) setError(upsertError.message);
    setSaving(false);
  }

  function toggleVisible() {
    const next = { ...state, visible: !state.visible };
    setState(next);
    persist(next);
  }

  function handleBlur(field: "locationText" | "lookingFor") {
    return () => {
      if (state[field] === initial[field]) return;
      persist(state);
    };
  }

  return (
    <div className="border border-steel/20 p-4 space-y-3">
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={state.visible}
          onChange={toggleVisible}
          disabled={saving}
          className="mt-1"
        />
        <span className="font-body text-sm">
          I&apos;m looking for a training partner — show my profile to other athletes on the
          platform, regardless of who coaches them.
        </span>
      </label>

      {state.visible && (
        <>
          <label className="block">
            <span className="font-body text-xs text-steel uppercase tracking-wide">
              Location (city, or your gym)
            </span>
            <input
              type="text"
              value={state.locationText}
              onChange={(e) => setState((s) => ({ ...s, locationText: e.target.value }))}
              onBlur={handleBlur("locationText")}
              placeholder="Las Vegas, NV"
              className="w-full h-10 mt-1 bg-graphite border border-steel/30 text-chalk px-2.5 font-body text-sm focus:outline-none focus:border-rust"
            />
          </label>
          <label className="block">
            <span className="font-body text-xs text-steel uppercase tracking-wide">
              What are you looking for?
            </span>
            <textarea
              value={state.lookingFor}
              onChange={(e) => setState((s) => ({ ...s, lookingFor: e.target.value }))}
              onBlur={handleBlur("lookingFor")}
              rows={2}
              placeholder="Goals, schedule, experience level — whatever helps someone decide to reach out."
              className="w-full mt-1 bg-graphite border border-steel/30 text-chalk px-2.5 py-2 font-body text-sm focus:outline-none focus:border-rust resize-none"
            />
          </label>
        </>
      )}

      {error && (
        <p className="font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
