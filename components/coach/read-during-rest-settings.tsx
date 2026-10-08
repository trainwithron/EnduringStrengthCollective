"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

export interface ReadOverrideRow {
  id: string;
  date: string;
  reference: string;
}

// Coach settings for Read during rest. One switch turns it off for ALL of this coach's clients (then Read is hidden for them entirely, whatever their own setting says).
// Below it, the coach may choose the passage for a particular day from the bundled list; every other day each client gets a passage picked for them automatically.
// Only the passage references come in as props: the passage text stays out of this screen's code.
export function ReadDuringRestSettings({
  coachId,
  initialDefaultOn,
  refs,
  initialOverrides,
  today,
}: {
  coachId: string;
  initialDefaultOn: boolean;
  refs: string[];
  initialOverrides: ReadOverrideRow[];
  today: string;
}) {
  const router = useRouter();
  const [on, setOn] = useState(initialDefaultOn);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overrides, setOverrides] = useState(initialOverrides);
  const [date, setDate] = useState(today);
  const [reference, setReference] = useState("");
  const [adding, setAdding] = useState(false);

  async function toggle() {
    const next = !on;
    setOn(next);
    setSaving(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: saveError } = await supabase
      .from("coach_preferences")
      .upsert({ coach_id: coachId, faith_track_default: next }, { onConflict: "coach_id" });
    if (saveError) {
      setOn(!next);
      setError("That didn't save. The switch is back to what it was.");
    } else {
      router.refresh();
    }
    setSaving(false);
  }

  async function addOverride() {
    if (!date || !reference || adding) return;
    setAdding(true);
    setError(null);
    const supabase = createBrowserClient();
    const { data, error: saveError } = await supabase
      .from("read_passage_overrides")
      .upsert({ coach_id: coachId, override_date: date, reference }, { onConflict: "coach_id,override_date" })
      .select("id, override_date, reference")
      .single();
    setAdding(false);
    if (saveError || !data) {
      setError("That didn't save. Try again.");
      return;
    }
    setOverrides((rows) =>
      [...rows.filter((r) => r.date !== data.override_date), { id: data.id, date: data.override_date, reference: data.reference }].sort((a, b) =>
        a.date.localeCompare(b.date)
      )
    );
    setReference("");
  }

  async function removeOverride(row: ReadOverrideRow) {
    const supabase = createBrowserClient();
    const { error: deleteError } = await supabase.from("read_passage_overrides").delete().eq("id", row.id);
    if (deleteError) {
      setError("That didn't delete. Try again.");
      return;
    }
    setOverrides((rows) => rows.filter((r) => r.id !== row.id));
  }

  return (
    <div>
      <label className="flex items-start justify-between gap-3 py-1">
        <span className="font-body text-sm text-chalk">
          Read during rest for my clients
          <span className="block font-body text-xs text-steel mt-0.5">
            A short King James passage beside the rest timer. Each client can also turn it off for themselves. Turn this off and it is hidden for all of your clients.
          </span>
        </span>
        <input
          type="checkbox"
          checked={on}
          onChange={toggle}
          disabled={saving}
          aria-label="Read during rest for my clients"
          className="w-5 h-5 shrink-0 mt-0.5 accent-rust"
        />
      </label>

      {on && (
        <div className="mt-4 pt-4 border-t border-steel/15">
          <p className="font-body text-xs text-steel uppercase tracking-wide mb-2">Passage for a day</p>
          <p className="font-body text-xs text-steel mb-3">Pick the passage your clients see on a day. Any other day, each client gets one chosen for them.</p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              aria-label="Day"
              className="h-10 px-2 bg-surface border border-steel/30 font-body text-sm text-chalk"
            />
            <select
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              aria-label="Passage"
              className="h-10 px-2 bg-surface border border-steel/30 font-body text-sm text-chalk max-w-full"
            >
              <option value="">Choose a passage</option>
              {refs.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={addOverride}
              disabled={!date || !reference || adding}
              className="h-10 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
            >
              {adding ? "Saving…" : "Set passage"}
            </button>
          </div>
          {overrides.length > 0 && (
            <ul className="mt-3 divide-y divide-steel/15">
              {overrides.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="font-body text-sm text-chalk">
                    {row.date} <span className="text-steel">·</span> {row.reference}
                  </span>
                  <button type="button" onClick={() => removeOverride(row)} className="font-body text-xs text-steel underline">
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
