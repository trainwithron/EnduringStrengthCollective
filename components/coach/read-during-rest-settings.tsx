"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { MAX_COACH_REFERENCE, MAX_COACH_TEXT } from "@/lib/read-content/limits";

export interface ReadOverrideRow {
  id: string;
  date: string;
  reference: string;
}

export interface OwnPassageRow {
  id: string;
  reference: string;
  text: string;
}

// Coach settings for Read during rest. One switch turns it off for ALL of this coach's clients (then Read is hidden for them entirely, whatever their own setting says).
// A passage is picked for every client automatically each day (lib/read-content: each client goes through the whole list in their own order, no repeats until they have seen them all).
// Choosing one for a particular day is optional, under one closed row (Ron, Oct 21: "I don't want to have to select it every day").
// Only the passage references come in as props: the passage text stays out of this screen's code.
export function ReadDuringRestSettings({
  coachId,
  initialDefaultOn,
  refs,
  initialOverrides,
  today,
  initialOwn = null,
}: {
  coachId: string;
  initialDefaultOn: boolean;
  refs: string[];
  initialOverrides: ReadOverrideRow[];
  today: string;
  // The passages this coach typed in himself (coach_read_passages, 0431); null hides Add a passage (the table could not be read).
  initialOwn?: OwnPassageRow[] | null;
}) {
  const router = useRouter();
  const [on, setOn] = useState(initialDefaultOn);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overrides, setOverrides] = useState(initialOverrides);
  const [date, setDate] = useState(today);
  const [reference, setReference] = useState("");
  const [adding, setAdding] = useState(false);
  const [own, setOwn] = useState<OwnPassageRow[] | null>(initialOwn);
  const [ownRef, setOwnRef] = useState("");
  const [ownText, setOwnText] = useState("");
  const [savingOwn, setSavingOwn] = useState(false);
  // The day picker offers his own passages too.
  const pickRefs = [...refs, ...(own ?? []).map((o) => o.reference).filter((r) => !refs.some((x) => x.toLowerCase() === r.toLowerCase()))];

  // Ron, Oct 21: "If I [feel] ones on my heart, I can put it in there." What he adds joins each of his clients' cycle.
  async function addOwn() {
    const reference = ownRef.trim();
    const text = ownText.trim();
    if (!reference || !text || savingOwn) return;
    setSavingOwn(true);
    setError(null);
    const { data, error: saveError } = await createBrowserClient().from("coach_read_passages").insert({ coach_id: coachId, reference, text }).select("id, reference, text").single();
    setSavingOwn(false);
    if (saveError || !data) {
      setError("That passage didn't save. Try again.");
      return;
    }
    setOwn((rows) => [...(rows ?? []), { id: data.id, reference: data.reference, text: data.text }]);
    setOwnRef("");
    setOwnText("");
  }

  async function removeOwn(row: OwnPassageRow) {
    const { error: deleteError } = await createBrowserClient().from("coach_read_passages").delete().eq("id", row.id);
    if (deleteError) {
      setError("That didn't delete. Try again.");
      return;
    }
    setOwn((rows) => (rows ?? []).filter((r) => r.id !== row.id));
  }

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
          <p className="font-body text-sm text-chalk" data-passage-automatic>A passage is picked for every client automatically each day.</p>
          <p className="font-body text-xs text-steel mt-0.5">Each client goes through the whole list in their own order, so nobody sees one again until they have seen them all.</p>
          <details className="mt-3 border border-steel/20" data-passage-day-choice>
            <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center justify-between gap-3 min-h-[44px] px-3">
              <span className="font-body text-sm text-chalk">Choose one for a specific day (optional)</span>
              <span className="font-body text-xs text-steel">{overrides.length > 0 ? `${overrides.length} chosen` : "▾"}</span>
            </summary>
            <div className="px-3 pb-3 pt-3 border-t border-steel/15">
          <p className="font-body text-xs text-steel mb-3">The passage you choose is the one all your clients see that day.</p>
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
              <option value="">Passage</option>
              {pickRefs.map((r) => (
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
              {adding ? "Saving…" : "Use on that day"}
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
          </details>

          {own !== null && (
            <div className="mt-4" data-own-passages>
              <p className="font-body text-sm text-chalk">Your own passages</p>
              <p className="font-body text-xs text-steel mt-0.5">Add a verse and it joins every client&apos;s cycle. King James first.</p>
              {own.length > 0 && (
                <ul className="mt-2 divide-y divide-steel/15">
                  {own.map((row) => (
                    <li key={row.id} className="flex items-start justify-between gap-3 py-2">
                      <span className="font-body text-sm text-chalk min-w-0">
                        {row.reference}
                        <span className="block font-body text-xs text-steel line-clamp-2">{row.text}</span>
                      </span>
                      <button type="button" onClick={() => removeOwn(row)} className="font-body text-xs text-steel underline shrink-0 min-h-[44px] -my-3 px-1">
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-2 space-y-2">
                <input
                  type="text"
                  value={ownRef}
                  onChange={(e) => setOwnRef(e.target.value)}
                  maxLength={MAX_COACH_REFERENCE}
                  placeholder="Reference, e.g. Joshua 1:9"
                  aria-label="Reference"
                  className="w-full h-10 px-2 bg-surface border border-steel/30 font-body text-sm text-chalk"
                />
                <textarea
                  value={ownText}
                  onChange={(e) => setOwnText(e.target.value)}
                  maxLength={MAX_COACH_TEXT}
                  rows={3}
                  placeholder="The verse, as you want it shown"
                  aria-label="Passage text"
                  className="w-full px-2 py-2 bg-surface border border-steel/30 font-body text-sm text-chalk"
                />
                <div className="flex items-center justify-between gap-3">
                  <span className="font-body text-xs text-steel">
                    {ownText.length} / {MAX_COACH_TEXT}
                  </span>
                  <button type="button" onClick={addOwn} disabled={!ownRef.trim() || !ownText.trim() || savingOwn} className="h-10 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
                    {savingOwn ? "Saving…" : "Add passage"}
                  </button>
                </div>
              </div>
            </div>
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
