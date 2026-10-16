"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { isUnder13 } from "@/lib/coppa";
import { validDateOfBirth } from "@/lib/dob-gate";

// The one-field date-of-birth step every client passes once. The date is saved where the app already reads it (client_intake.date_of_birth); a child under 13 stops at the consent message below
// until their coach has confirmed a parent or guardian's consent.
export function BirthdayForm({
  groupId,
  coachName,
  initialDateOfBirth,
  alreadySaved,
  consentVerified,
  nextUrl,
}: {
  groupId: string;
  coachName: string | null;
  initialDateOfBirth: string | null;
  // The date shown was saved earlier (it is not just a suggestion from the profile's own birthday).
  alreadySaved: boolean;
  consentVerified: boolean;
  nextUrl: string;
}) {
  const router = useRouter();
  const [dob, setDob] = useState(initialDateOfBirth ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(alreadySaved && !!initialDateOfBirth && isUnder13(initialDateOfBirth, new Date()) && !consentVerified);

  async function save() {
    if (saving) return;
    if (!validDateOfBirth(dob)) {
      setError("Enter a real date, like 1990-04-23.");
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("Your session ended. Please sign in again.");
      setSaving(false);
      return;
    }
    // An existing intake row keeps its group (a client in two groups has one form, and who reads it follows that group): only the date is written. A first row is filed in the client's group.
    const { data: existingRow } = await supabase.from("client_intake").select("athlete_id").eq("athlete_id", user.id).maybeSingle();
    const { error: upsertError } = existingRow
      ? await supabase.from("client_intake").update({ date_of_birth: dob }).eq("athlete_id", user.id)
      : await supabase.from("client_intake").insert({ athlete_id: user.id, group_id: groupId, date_of_birth: dob });
    if (upsertError) {
      setError("We couldn't save that. Check your connection and try again.");
      setSaving(false);
      return;
    }
    setSaving(false);
    if (isUnder13(dob, new Date()) && !consentVerified) {
      setBlocked(true);
      // Tell the coach a child is waiting (best effort; the child's screen does not depend on it).
      void fetch("/api/intake/minor-consent-notice", { method: "POST" }).catch(() => {});
      return;
    }
    router.push(nextUrl);
    router.refresh();
  }

  if (blocked) {
    return (
      <div className="border border-steel/20 p-6 space-y-4">
        <p className="font-body text-sm">
          Because you&apos;re under 13, U.S. law (COPPA) requires your parent or guardian to give verified consent before we can collect anything else about you. {coachName ?? "Your coach"} will reach out to
          your parent or guardian directly to complete this. Check back once that&apos;s done.
        </p>
        <button type="button" onClick={() => router.refresh()} className="font-body text-xs text-steel uppercase tracking-wide underline">
          Check again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <label htmlFor="birthday-input" className="font-body text-sm text-chalk block">
        Date of birth
      </label>
      <input
        id="birthday-input"
        type="date"
        value={dob}
        max={new Date().toISOString().slice(0, 10)}
        onChange={(e) => setDob(e.target.value)}
        className="w-full h-11 bg-surface border border-steel/30 text-chalk px-3 font-body focus:outline-none focus:border-rust"
      />
      {error && (
        <p className="font-body text-sm text-rust" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={save}
        disabled={!dob || saving}
        className="w-full h-12 bg-rust text-graphite font-display uppercase text-lg font-bold disabled:opacity-40 active:bg-rust/80 transition-colors"
      >
        {saving ? "Saving…" : "Continue"}
      </button>
    </div>
  );
}
