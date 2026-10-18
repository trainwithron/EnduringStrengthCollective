"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { confirmDialog } from "@/components/shared/confirm-dialog";
import { suggestSeasonName } from "@/lib/season-name";
import { hasGraduated } from "@/lib/graduation";
import Link from "next/link";

export interface SeasonAthlete {
  profileId: string;
  fullName: string;
  positionName: string | null;
  // The class year the coach gave them (null if none).
  graduationYear?: number | null;
}

// Starts next season for a team: a new group with the same positions and coaches and the athletes ticked here, and this season is retired (kept, with all its records, in Past seasons). Tick off the ones who are
// leaving. Nothing from this season is copied into the new one; it starts clean.
export function NewSeasonPanel({ groupId, groupName, athletes }: { groupId: string; groupName: string; athletes: SeasonAthlete[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(() => suggestSeasonName(groupName));
  // A player whose class has graduated starts unticked; the coach can tick them.
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(athletes.filter((a) => !hasGraduated(a.graduationYear)).map((a) => a.profileId)));
  const [finished, setFinished] = useState<{ id: string; note: string } | null>(null);
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
    if (chosen.size === 0) {
      setError("Tick at least one athlete to bring over.");
      return;
    }
    const leaving = athletes.filter((a) => hasGraduated(a.graduationYear) && !chosen.has(a.profileId)).length;
    const emailNote = leaving > 0 ? ` ${leaving} graduating player${leaving === 1 ? " is" : "s are"} not coming back and will each be emailed a PDF of their own training history, to their own address only.` : "";
    if (!(await confirmDialog({ message: `Start ${trimmed} with ${chosen.size} athlete${chosen.size === 1 ? "" : "s"}? ${groupName} is retired: it and all its records are kept in Past seasons, and nothing from it is copied into the new season.${emailNote}`, confirmLabel: "Start the season" }))) return;
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await createBrowserClient().rpc("start_next_season", { p_group: groupId, p_name: trimmed, p_athletes: [...chosen] });
    setBusy(false);
    if (rpcError || typeof data !== "string") {
      setError(rpcError?.message ?? "Couldn't start the season. Try again.");
      return;
    }
    // The graduating players are emailed their history from the server; a failure there never undoes the new season.
    if (leaving > 0) {
      let note = "";
      try {
        const res = await fetch("/api/season/graduate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ groupId }) });
        const result = await res.json().catch(() => ({}));
        if (res.ok && !result.emailOff) {
          const parts = [`${result.sent ?? 0} graduating player${result.sent === 1 ? "" : "s"} emailed their training history.`];
          if (result.noEmail) parts.push(`${result.noEmail} had no email address that can receive it.`);
          if (result.failed) parts.push(`${result.failed} could not be sent.`);
          note = parts.join(" ");
        } else {
          note = "The season is started, but the graduating players could not be emailed their history just now.";
        }
      } catch {
        note = "The season is started, but the graduating players could not be emailed their history just now.";
      }
      setFinished({ id: data, note });
      router.refresh();
      return;
    }
    router.push(`/groups/${data}/team`);
    router.refresh();
  }

  if (finished) {
    return (
      <div className="border border-steel/25 p-4 max-w-xl">
        <p className="font-body text-sm">{finished.note}</p>
        <Link href={`/groups/${finished.id}/team`} className="inline-block mt-3 font-body text-sm text-rust">
          Go to the new season →
        </Link>
      </div>
    );
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
            {a.graduationYear ? <span className="text-xs text-steel">{hasGraduated(a.graduationYear) ? `Class of ${a.graduationYear} (graduated)` : `Class of ${a.graduationYear}`}</span> : null}
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
