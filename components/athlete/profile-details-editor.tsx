"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

export interface ProfileDetails {
  bio: string;
  birthday: string;
  phone: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
}

// Self-reported, athlete-owned — not the coach's private notes (that's
// athlete_notes, a separate coach-authored table). Same blur-persist
// pattern as AthleteNotesEditor; upserts the whole row on any field blur
// since it's one row per athlete, not one row per field.
export function ProfileDetailsEditor({
  athleteId,
  initial,
}: {
  athleteId: string;
  initial: ProfileDetails;
}) {
  const [details, setDetails] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function persist(next: ProfileDetails) {
    setSaving(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: upsertError } = await supabase.from("athlete_profile_details").upsert({
      athlete_id: athleteId,
      bio: next.bio || null,
      birthday: next.birthday || null,
      phone: next.phone || null,
      emergency_contact_name: next.emergencyContactName || null,
      emergency_contact_phone: next.emergencyContactPhone || null,
      updated_at: new Date().toISOString(),
    });
    if (upsertError) setError(upsertError.message);
    setSaving(false);
  }

  function handleBlur(field: keyof ProfileDetails) {
    return () => {
      if (details[field] === initial[field]) return;
      persist(details);
    };
  }

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="profile-bio" className="font-body text-xs text-steel">
          About me
        </label>
        <textarea
          id="profile-bio"
          value={details.bio}
          onChange={(e) => setDetails((d) => ({ ...d, bio: e.target.value }))}
          onBlur={handleBlur("bio")}
          rows={3}
          placeholder="Why you train, hobbies, whatever you want your coach to know about you."
          className="w-full mt-1 bg-graphite border border-steel/30 text-chalk px-2.5 py-2 font-body text-sm focus:outline-none focus:border-rust resize-none"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="profile-birthday" className="font-body text-xs text-steel">
            Birthday
          </label>
          <input
            id="profile-birthday"
            type="date"
            value={details.birthday}
            onChange={(e) => setDetails((d) => ({ ...d, birthday: e.target.value }))}
            onBlur={handleBlur("birthday")}
            className="w-full mt-1 h-10 bg-graphite border border-steel/30 text-chalk px-2.5 font-body text-sm focus:outline-none focus:border-rust"
          />
        </div>
        <div>
          <label htmlFor="profile-phone" className="font-body text-xs text-steel">
            Phone
          </label>
          <input
            id="profile-phone"
            type="tel"
            value={details.phone}
            onChange={(e) => setDetails((d) => ({ ...d, phone: e.target.value }))}
            onBlur={handleBlur("phone")}
            className="w-full mt-1 h-10 bg-graphite border border-steel/30 text-chalk px-2.5 font-body text-sm focus:outline-none focus:border-rust"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="profile-emergency-name" className="font-body text-xs text-steel">
            Emergency contact name
          </label>
          <input
            id="profile-emergency-name"
            type="text"
            value={details.emergencyContactName}
            onChange={(e) => setDetails((d) => ({ ...d, emergencyContactName: e.target.value }))}
            onBlur={handleBlur("emergencyContactName")}
            className="w-full mt-1 h-10 bg-graphite border border-steel/30 text-chalk px-2.5 font-body text-sm focus:outline-none focus:border-rust"
          />
        </div>
        <div>
          <label htmlFor="profile-emergency-phone" className="font-body text-xs text-steel">
            Emergency contact phone
          </label>
          <input
            id="profile-emergency-phone"
            type="tel"
            value={details.emergencyContactPhone}
            onChange={(e) => setDetails((d) => ({ ...d, emergencyContactPhone: e.target.value }))}
            onBlur={handleBlur("emergencyContactPhone")}
            className="w-full mt-1 h-10 bg-graphite border border-steel/30 text-chalk px-2.5 font-body text-sm focus:outline-none focus:border-rust"
          />
        </div>
      </div>
      <p className="font-body text-[11px] text-steel">
        Only visible to you and your coach — never shown to other clients.
      </p>
      {saving && <p className="font-body text-xs text-steel">Saving…</p>}
      {error && (
        <p className="font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
