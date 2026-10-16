"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// One line on a client's profile when no birthday is on file: their age decides which protections the AI builder uses (a young athlete, or an unknown age, is programmed more carefully). One field and one button.
export const ADD_BIRTHDAY_NOTE = "No birthday on file. Add it so programs can be built for their age.";

export function AddBirthdayPrompt({ groupId, athleteId, suggestion }: { groupId: string; athleteId: string; suggestion: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(suggestion ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/clients/birthday", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ groupId, athleteId, dateOfBirth: value }) }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res || !res.ok) {
      setError((data as { error?: string }).error ?? "Couldn't save the birthday. Try again.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="border border-steel/25 p-3 max-w-md">
      <p className="font-body text-xs text-steel">{ADD_BIRTHDAY_NOTE}</p>
      <div className="mt-2 flex items-center gap-2">
        <input
          type="date"
          value={value}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Birthday"
          className="h-11 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust"
        />
        <button type="button" onClick={() => void save()} disabled={!value || busy} className="min-h-11 px-4 border border-rust text-rust font-display font-bold uppercase tracking-wide disabled:opacity-40">
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
