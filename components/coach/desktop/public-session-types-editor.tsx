"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

export interface PublicTypeEditRow {
  id: string;
  name: string;
  durationMinutes: number;
  locationKind: "in_person" | "online" | "either";
  locationText: string;
  description: string;
  displayPrice: string; // dollars as typed, "" for none
  publicVisible: boolean;
}

const input = "bg-surface border border-steel/30 text-chalk px-2.5 py-1.5 font-body text-sm focus:outline-none focus:border-rust";

function priceToCents(value: string): number | null {
  const t = value.trim().replace(/^\$/, "");
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

// Which of the coach's session types are offered on the public page, and what a visitor sees: length, where it happens, a
// short description and an optional price. Each change saves as you leave the field.
export function PublicSessionTypesEditor({ initialTypes }: { initialTypes: PublicTypeEditRow[] }) {
  const [types, setTypes] = useState(initialTypes);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);

  async function persist(id: string, patch: Record<string, unknown>) {
    const supabase = createBrowserClient();
    const { error } = await supabase.from("session_types").update(patch).eq("id", id);
    setNote(error ? { text: "That didn't save. Try again.", error: true } : null);
  }

  function update(id: string, change: Partial<PublicTypeEditRow>) {
    setTypes((prev) => prev.map((t) => (t.id === id ? { ...t, ...change } : t)));
  }

  async function addType() {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusy(false);
      return;
    }
    const { data, error } = await supabase
      .from("session_types")
      .insert({ coach_id: user.id, name, credit_cost: 1, duration_minutes: 60, location_kind: "in_person", public_visible: true, sort_order: types.length })
      .select("id, name, duration_minutes, location_kind, location_text, description, display_price_cents, public_visible")
      .single();
    setBusy(false);
    if (error || !data) {
      setNote({ text: "That didn't save. Try again.", error: true });
      return;
    }
    setTypes((prev) => [
      ...prev,
      {
        id: data.id,
        name: data.name,
        durationMinutes: data.duration_minutes,
        locationKind: data.location_kind,
        locationText: data.location_text ?? "",
        description: data.description ?? "",
        displayPrice: data.display_price_cents == null ? "" : String(data.display_price_cents / 100),
        publicVisible: data.public_visible,
      },
    ]);
    setNewName("");
  }

  return (
    <div className="max-w-2xl">
      {types.length === 0 && <p className="font-body text-sm text-steel mb-4">No session types yet. Add the kinds of session you want people to book.</p>}

      <div className="space-y-3">
        {types.map((t) => (
          <div key={t.id} className="border border-steel/25 p-4">
            <div className="flex items-start justify-between gap-3">
              <input
                className={`${input} flex-1 min-w-0`}
                value={t.name}
                aria-label="Session type name"
                maxLength={80}
                onChange={(e) => update(t.id, { name: e.target.value })}
                onBlur={() => t.name.trim() && persist(t.id, { name: t.name.trim() })}
              />
              <label className="flex items-center gap-2 font-body text-sm text-chalk shrink-0">
                <input
                  type="checkbox"
                  checked={t.publicVisible}
                  className="accent-rust"
                  onChange={(e) => {
                    update(t.id, { publicVisible: e.target.checked });
                    persist(t.id, { public_visible: e.target.checked });
                  }}
                />
                On my booking page
              </label>
            </div>

            {t.publicVisible && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="font-body text-xs text-steel block mb-1">Length (minutes)</span>
                  <input
                    className={`${input} w-28`}
                    type="number"
                    min={5}
                    max={480}
                    step={5}
                    value={t.durationMinutes}
                    onChange={(e) => update(t.id, { durationMinutes: Number(e.target.value) || 0 })}
                    onBlur={() => t.durationMinutes >= 5 && t.durationMinutes <= 480 && persist(t.id, { duration_minutes: t.durationMinutes })}
                  />
                </label>
                <label className="block">
                  <span className="font-body text-xs text-steel block mb-1">Where</span>
                  <select
                    className={`${input} w-full`}
                    value={t.locationKind}
                    onChange={(e) => {
                      const v = e.target.value as PublicTypeEditRow["locationKind"];
                      update(t.id, { locationKind: v });
                      persist(t.id, { location_kind: v });
                    }}
                  >
                    <option value="in_person">In person</option>
                    <option value="online">Online</option>
                    <option value="either">In person or online</option>
                  </select>
                </label>
                <label className="block sm:col-span-2">
                  <span className="font-body text-xs text-steel block mb-1">Place or link note (optional)</span>
                  <input
                    className={`${input} w-full`}
                    value={t.locationText}
                    maxLength={120}
                    placeholder="e.g. Downtown studio, or the video link is sent before the session"
                    onChange={(e) => update(t.id, { locationText: e.target.value })}
                    onBlur={() => persist(t.id, { location_text: t.locationText.trim() || null })}
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="font-body text-xs text-steel block mb-1">Description (optional)</span>
                  <textarea
                    className={`${input} w-full`}
                    rows={2}
                    value={t.description}
                    maxLength={300}
                    onChange={(e) => update(t.id, { description: e.target.value })}
                    onBlur={() => persist(t.id, { description: t.description.trim() || null })}
                  />
                </label>
                <label className="block">
                  <span className="font-body text-xs text-steel block mb-1">Price to display (optional)</span>
                  <input
                    className={`${input} w-28`}
                    inputMode="decimal"
                    value={t.displayPrice}
                    placeholder="e.g. 95"
                    onChange={(e) => update(t.id, { displayPrice: e.target.value })}
                    onBlur={() => persist(t.id, { display_price_cents: priceToCents(t.displayPrice) })}
                  />
                  <span className="font-body text-xs text-steel block mt-1">Shown only if you turn on prices for the page. Never charged here.</span>
                </label>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-end gap-3 mt-4">
        <label className="block flex-1">
          <span className="font-body text-xs text-steel uppercase tracking-wide block mb-1">New session type</span>
          <input className={`${input} w-full`} value={newName} maxLength={80} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. 1-on-1 training" />
        </label>
        <button
          type="button"
          onClick={addType}
          disabled={busy || !newName.trim()}
          className="bg-rust text-graphite font-display font-bold uppercase tracking-wide px-4 py-2 disabled:opacity-40"
        >
          Add
        </button>
      </div>
      {note && (
        <p className={`font-body text-sm mt-3 ${note.error ? "text-rust" : "text-steel"}`} role={note.error ? "alert" : "status"}>
          {note.text}
        </p>
      )}
    </div>
  );
}
