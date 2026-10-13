"use client";

import { useState } from "react";
import { ProgramCardGrid, type ProgramCardData } from "@/components/coach/desktop/program-card-grid";
import type { ProgramCardVisualData } from "@/lib/program-card-data";
import { applyProgramsFilter, clientOptions, newestFirst, typeOptions, type ProgramsFilterMode } from "@/lib/programs-filter";

// The Programs page: one flat list of cards with a single "Filter by" control. No headings, no fold.
export function ProgramsList({ groupId, programs, visualsByProgramId }: { groupId: string; programs: ProgramCardData[]; visualsByProgramId: Record<string, ProgramCardVisualData> }) {
  const [mode, setMode] = useState<ProgramsFilterMode>("all");
  const [value, setValue] = useState<string>("");
  const clients = clientOptions(programs);
  const types = typeOptions(programs);
  const shown = newestFirst(applyProgramsFilter(programs, mode, value || null));
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
      <ProgramCardGrid groupId={groupId} programs={shown} visualsByProgramId={visualsByProgramId} />
    </div>
  );
}
