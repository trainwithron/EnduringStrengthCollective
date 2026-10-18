"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { resetCoachNavFacts } from "@/components/coach/use-coach-type";
import { COACH_TYPES, type CoachType } from "@/lib/coach-type";

// "What do you coach?" — answered at signup, changeable here. It decides which way Add client leans first.
export function CoachTypeSetting({ profileId, initial }: { profileId: string; initial: CoachType | null }) {
  const [value, setValue] = useState<CoachType | "">(initial ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  async function choose(next: CoachType) {
    const previous = value;
    setValue(next);
    setSaving(true);
    setMessage(null);
    const { error } = await createBrowserClient().from("profiles").update({ coach_type: next }).eq("id", profileId);
    setSaving(false);
    if (error) {
      setValue(previous);
      setMessage("Couldn't save that. Try again.");
      return;
    }
    setMessage("Saved.");
    // The menus follow at once.
    resetCoachNavFacts();
    router.refresh();
  }

  return (
    <div className="py-3">
      <p className="font-body text-sm text-chalk">What do you coach?</p>
      <div className="mt-2 space-y-2">
        {COACH_TYPES.map((t) => (
          <label key={t.value} className={`flex items-start gap-3 border px-3 py-2.5 cursor-pointer ${value === t.value ? "border-rust" : "border-steel/30"}`}>
            <input type="radio" name="coach-type-setting" checked={value === t.value} disabled={saving} onChange={() => void choose(t.value)} className="mt-1" />
            <span>
              <span className="block font-body text-sm text-chalk">{t.label}</span>
              <span className="block font-body text-xs text-steel">{t.hint}</span>
            </span>
          </label>
        ))}
      </div>
      <p className="font-body text-xs text-steel mt-2">
        A team coach&apos;s menus leave out booking pages, availability, session types, the website, the pro shop and referrals, leads and the session ledger. They come back if you choose another option here, and they always stay if you have a one-on-one client or run an organization with other coaches or staff.
      </p>
      {message && (
        <p className="font-body text-xs text-steel mt-1" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
