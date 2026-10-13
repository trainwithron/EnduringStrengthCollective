"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ProgramCardGrid, type ProgramCardData } from "@/components/coach/desktop/program-card-grid";
import { confirmDialog } from "@/components/shared/confirm-dialog";
import { createBrowserClient } from "@/lib/supabase/client";
import { assignedBlockMessage, loadAssignedTo } from "@/lib/program-assigned";
import type { ProgramCardVisualData } from "@/lib/program-card-data";
import { applyProgramsFilter, clientOptions, firstName, newestFirst, removedFor, typeOptions, type ProgramsFilterMode, type RemovedProgram } from "@/lib/programs-filter";

// The Programs page: one flat list of cards with a single "Filter by" control. No headings, no fold. A program the coach removed is still findable (under "Removed programs", and under its client in
// "One client") with Put back and Delete, so nothing is ever lost from view.
export function ProgramsList({
  groupId,
  programs,
  removed,
  visualsByProgramId,
}: {
  groupId: string;
  programs: ProgramCardData[];
  removed: RemovedProgram[];
  visualsByProgramId: Record<string, ProgramCardVisualData>;
}) {
  const [mode, setMode] = useState<ProgramsFilterMode>("all");
  const [value, setValue] = useState<string>("");
  const clients = clientOptions([...programs, ...removed]);
  const types = typeOptions(programs);
  const shown = newestFirst(applyProgramsFilter(programs, mode, value || null));
  const removedShown = removedFor(removed, mode, value || null);
  const select = "min-h-11 bg-graphite border border-steel/40 text-chalk px-2 font-body text-sm";

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <label className="font-body text-sm text-steel flex items-center gap-2">
          Filter by
          <select
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as ProgramsFilterMode);
              setValue("");
            }}
            className={select}
          >
            <option value="all">All programs</option>
            <option value="shared">Shared programs</option>
            <option value="client">One client</option>
            {types.length > 0 && <option value="type">Program type</option>}
            <option value="templates">Templates</option>
            {removed.length > 0 && <option value="removed">Removed programs ({removed.length})</option>}
          </select>
        </label>
        {mode === "client" && (
          <select value={value} onChange={(e) => setValue(e.target.value)} className={select} aria-label="Choose a client">
            <option value="">Choose a client</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        {mode === "type" && (
          <select value={value} onChange={(e) => setValue(e.target.value)} className={select} aria-label="Choose a type">
            <option value="">Choose a type</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}
      </div>
      {mode !== "removed" && <ProgramCardGrid groupId={groupId} programs={shown} visualsByProgramId={visualsByProgramId} />}
      {removedShown.length > 0 && <RemovedRows rows={removedShown} />}
      {mode === "removed" && removedShown.length === 0 && <p className="font-body text-sm text-steel">Nothing removed.</p>}
      {mode === "templates" && shown.length === 0 && <p className="font-body text-sm text-steel">No templates yet. Add a slot to a day of a program to make one.</p>}
    </div>
  );
}

function RemovedRows({ rows }: { rows: RemovedProgram[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function putBack(id: string) {
    if (busyId) return;
    setBusyId(id);
    setError(null);
    const { error: updateError } = await createBrowserClient().from("programs").update({ archived_at: null }).eq("id", id);
    setBusyId(null);
    if (updateError) {
      setError("Couldn't put it back. Try again.");
      return;
    }
    router.refresh();
  }

  async function remove(row: RemovedProgram) {
    if (busyId) return;
    setError(null);
    const supabase = createBrowserClient();
    // A program that people have their own versions of is not deleted from under them.
    const assigned = (await loadAssignedTo(supabase, row.id)).length;
    if (assigned > 0) {
      setError(assignedBlockMessage(assigned));
      return;
    }
    if (!(await confirmDialog(`Delete "${row.name}"? Any real logged history stays intact.`))) return;
    setBusyId(row.id);
    const { error: deleteError } = await supabase.from("programs").delete().eq("id", row.id);
    setBusyId(null);
    if (deleteError) {
      setError("Couldn't delete it. It may have logged sessions tied to it.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="mt-4">
      <ul className="divide-y divide-steel/15 border-y border-steel/15">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 px-1">
            <span className="min-w-0">
              <span className="block font-body text-sm text-chalk truncate">{r.name}</span>
              <span className="block font-body text-xs text-steel truncate">
                Removed{r.athleteName ? ` \u00b7 For ${firstName(r.athleteName)}` : ""}
              </span>
            </span>
            <span className="flex items-center shrink-0">
              <button type="button" disabled={busyId !== null} onClick={() => putBack(r.id)} className="min-h-11 px-3 font-body text-xs text-rust disabled:opacity-40">
                {busyId === r.id ? "Working…" : "Put back"}
              </button>
              <button type="button" disabled={busyId !== null} onClick={() => remove(r)} className="min-h-11 px-3 font-body text-xs text-steel active:text-rust disabled:opacity-40">
                Delete
              </button>
            </span>
          </li>
        ))}
      </ul>
      {error && (
        <p className="font-body text-xs text-rust mt-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
