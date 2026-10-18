"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { isUnder13 } from "@/lib/coppa";
import { validDateOfBirth } from "@/lib/dob-gate";

// The one-field date-of-birth step every client passes once. The date is saved where the app already reads it (client_intake.date_of_birth). A child under 13 stops at the message below: the app is for people 13
// and older. (A client aged 13 to 17 goes on to ask a parent or guardian for permission, on the next screen.)
export function BirthdayForm({
  groupId,
  coachName,
  initialDateOfBirth,
  alreadySaved,
  nextUrl,
}: {
  groupId: string;
  coachName: string | null;
  initialDateOfBirth: string | null;
  // The date shown was saved earlier (it is not just a suggestion from the profile's own birthday).
  alreadySaved: boolean;
  nextUrl: string;
}) {
  const router = useRouter();
  const [dob, setDob] = useState(initialDateOfBirth ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(alreadySaved && !!initialDateOfBirth && isUnder13(initialDateOfBirth, new Date()));

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
      // A date that is already on file cannot be changed from here (a database guard); everything else is a plain failure to save.
      setError(upsertError.code === "42501" || /birthday can't be changed here/i.test(upsertError.message ?? "") ? "Your birthday can't be changed here. Ask your coach to contact support." : "We couldn't save that. Check your connection and try again.");
      setSaving(false);
      return;
    }
    setSaving(false);
    if (isUnder13(dob, new Date())) {
      setBlocked(true);
      // Tell the coach why this child is not training (best effort; the child's screen does not depend on it).
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
          Spotlight Coaching is for people 13 and older, so we can&apos;t set up an account for you yet, and we haven&apos;t asked you for anything else. A parent or guardian can talk to {coachName ?? "your coach"} about other options. If the date you entered is wrong, ask {coachName ?? "your coach"} to contact support.
        </p>
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
