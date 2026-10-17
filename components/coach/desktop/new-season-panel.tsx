"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { confirmDialog } from "@/components/shared/confirm-dialog";
import { suggestSeasonName } from "@/lib/season-name";

export interface SeasonAthlete {
  profileId: string;
  fullName: string;
  positionName: string | null;
}

// Starts next season for a team: a new group with the same positions and coaches and the athletes ticked here, and this season is retired (kept, with all its records, in Past seasons). Tick off the ones who are
// leaving. Nothing from this season is copied into the new one; it starts clean.
export function NewSeasonPanel({ groupId, groupName, athletes }: { groupId: string; groupName: string; athletes: SeasonAthlete[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(() => suggestSeasonName(groupName));
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(athletes.map((a) => a.profileId)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function start() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give the new season a name.");
      return;
    }
    if (!(await confirmDialog({ message: `Start ${trimmed} with ${chosen.size} athlete${chosen.size === 1 ? "" : "s"}? ${groupName} is retired: it and all its records are kept in Past seasons, and nothing from it is copied into the new season.`, confirmLabel: "Start the season" }))) return;
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await createBrowserClient().rpc("start_new_season", { p_group: groupId, p_name: trimmed, p_athletes: [...chosen] });
    setBusy(false);
    if (rpcError || typeof data !== "string") {
      setError(rpcError?.message ?? "Couldn't start the season. Try again.");
      return;
    }
    router.push(`/groups/${data}/team`);
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="h-11 px-4 border border-rust text-rust font-body text-sm font-medium">
        Start next season
      </button>
    );
  }

  return (
    <div className="border border-steel/25 p-4 max-w-xl">
      <label htmlFor="season-name" className="font-body text-xs text-steel uppercase tracking-wide">
        Name of the new season
      </label>
      <input id="season-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} className="w-full h-11 mt-1 bg-graphite border border-steel/30 text-chalk px-2.5 font-body text-base sm:text-sm" />
      <p className="font-body text-xs text-steel uppercase tracking-wide mt-4 mb-1">
        Athletes coming back ({chosen.size} of {athletes.length})
      </p>
      <div className="max-h-64 overflow-y-auto border border-steel/20">
        {athletes.map((a) => (
          <label key={a.profileId} className="flex items-center gap-3 px-3 py-2 border-b border-steel/10 last:border-b-0 font-body text-sm">
            <input type="checkbox" checked={chosen.has(a.profileId)} onChange={() => toggle(a.profileId)} />
            <span className="flex-1 truncate">{a.fullName}</span>
            {a.positionName && <span className="text-xs text-steel">{a.positionName}</span>}
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-3">
        <button type="button" onClick={() => setChosen(new Set(athletes.map((a) => a.profileId)))} className="font-body text-xs text-steel underline">
          Tick all
        </button>
        <button type="button" onClick={() => setChosen(new Set())} className="font-body text-xs text-steel underline">
          Untick all
        </button>
      </div>
      {error && (
        <p className="font-body text-xs text-rust mt-3" role="alert">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3 mt-4">
        <button type="button" onClick={start} disabled={busy} className="h-11 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
          {busy ? "Starting…" : "Start the season"}
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={busy} className="font-body text-xs text-steel">
          Cancel
        </button>
      </div>
    </div>
  );
}
