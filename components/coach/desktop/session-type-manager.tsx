"use client";

import { confirmDialog } from "@/components/shared/confirm-dialog";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { Trash2, Plus } from "lucide-react";
import { PRESET_SETS, missingPresets, type PresetSetKey } from "@/lib/session-type-presets";

export interface SessionTypeRow {
  id: string;
  name: string;
}

// gym_owner_multi_trainer_session_tracking_real_prospect.md — most
// coaches never touch this at all (every session stays the implicit,
// unnamed "training session"). Every session, of any type, costs exactly 1
// credit; a type only tells kinds of sessions apart.
export function SessionTypeManager({ initialTypes, teamMode = false }: { initialTypes: SessionTypeRow[]; teamMode?: boolean }) {
  const router = useRouter();
  const [types, setTypes] = useState(initialTypes);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [presetError, setPresetError] = useState<string | null>(null);

  async function handleAdd() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusy(false);
      return;
    }
    const { data } = await supabase
      .from("session_types")
      .insert({ coach_id: user.id, name: trimmed })
      .select("id, name")
      .single();
    if (data) {
      setTypes((prev) => [...prev, { id: data.id, name: data.name }]);
      setName("");
      router.refresh();
    }
    setBusy(false);
  }

  // One tap adds a starter set as ordinary private session types the coach can rename, change or delete (nothing is added twice).
  async function addPresets(set: PresetSetKey) {
    const missing = missingPresets(set, types.map((t) => t.name));
    if (missing.length === 0 || busy) return;
    setBusy(true);
    setPresetError(null);
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
      .insert(missing.map((p) => ({ coach_id: user.id, name: p.name, location_kind: p.locationKind, public_visible: false })))
      .select("id, name");
    setBusy(false);
    if (error || !data) {
      setPresetError("That didn't save. Nothing was added. Try again.");
      return;
    }
    setTypes((prev) => [...prev, ...data.map((d) => ({ id: d.id, name: d.name }))]);
    router.refresh();
  }

  async function handleDelete(id: string) {
    if (!await confirmDialog("Delete this session type? Existing logged sessions keep their history either way.")) return;
    const supabase = createBrowserClient();
    await supabase.from("session_types").delete().eq("id", id);
    setTypes((prev) => prev.filter((t) => t.id !== id));
    router.refresh();
  }

  return (
    <div className="max-w-2xl">
      <p className="font-body text-sm text-steel mb-4 max-w-[60ch]">
        Every session you log spends exactly 1 credit, whatever its type. Create a type here to tell kinds of sessions
        apart (Online, In person, Practice, Game...). A type can be given to a window of hours on Availability, and sessions
        booked inside those hours carry it.
      </p>

      <div className="mb-5 border border-steel/20 p-3">
        <p className="font-body text-xs text-steel uppercase tracking-wide mb-2">Start from a set</p>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(PRESET_SETS) as PresetSetKey[]).map((key) => {
            const left = missingPresets(key, types.map((t) => t.name));
            const suggested = (key === "team") === teamMode;
            return (
              <button
                key={key}
                type="button"
                disabled={busy || left.length === 0}
                onClick={() => addPresets(key)}
                className={`min-h-11 px-4 border font-body text-sm disabled:opacity-40 ${suggested ? "border-rust text-rust" : "border-steel/30 text-chalk"}`}
              >
                {PRESET_SETS[key].label}: {PRESET_SETS[key].presets.map((p) => p.name).join(", ")}
                {left.length === 0 ? " (added)" : ""}
              </button>
            );
          })}
        </div>
        <p className="font-body text-xs text-steel mt-2">
          They are ordinary types you can rename or delete, and they are not shown on your public booking page. Giving hours or a booked session a type never changes what the booking costs: every session is 1 credit.
        </p>
        {presetError && (
          <p className="font-body text-xs text-rust mt-1" role="alert">
            {presetError}
          </p>
        )}
      </div>

      {types.length > 0 && (
        <div className="divide-y divide-steel/15 border-y border-steel/15 mb-4">
          {types.map((t) => (
            <div key={t.id} className="py-2.5 flex items-center justify-between">
              <span className="font-body text-sm">{t.name}</span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => handleDelete(t.id)}
                  aria-label={`Delete ${t.name}`}
                  className="text-steel active:text-rust"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="font-body text-xs text-steel uppercase tracking-wide">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Check-in"
            className="h-10 w-56 bg-surface border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
          />
        </div>
        <button
          type="button"
          onClick={handleAdd}
          disabled={busy || !name.trim()}
          className="h-10 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40 flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" />
          Add type
        </button>
      </div>
    </div>
  );
}
