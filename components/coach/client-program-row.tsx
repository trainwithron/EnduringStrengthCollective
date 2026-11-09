"use client";

import { useState } from "react";
import Link from "next/link";
import { ClientProgramMenu } from "@/components/coach/client-program-menu";
import { ProgramNameInput } from "@/components/coach/program-name-input";

// One program on a client's Programs tab, as a short card like the logged workouts: the card opens it; the three-dot menu renames it in place (this client's copy only), switches it active, or takes it off the profile.
export function ClientProgramRow({
  groupId,
  program,
  clientName,
  stats,
}: {
  groupId: string;
  program: { id: string; name: string; is_active: boolean; ai_draft?: boolean };
  clientName: string;
  stats: { value: string; label: string }[];
}) {
  const [renaming, setRenaming] = useState(false);
  return (
    <li className="flex items-start border border-steel/20 bg-chalk/[0.03]">
      {renaming ? (
        <ProgramNameInput programId={program.id} initial={program.name} onDone={() => setRenaming(false)} className="flex-1 min-w-0 px-4 py-3" />
      ) : (
        <Link href={`/groups/${groupId}/programs/${program.id}`} className="block flex-1 min-w-0 px-4 py-3 hover:bg-surface/40 transition-colors">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="min-w-0">
              <span className={`font-body text-xs shrink-0 ${program.ai_draft ? "text-rust" : program.is_active ? "text-positive" : "text-steel"}`}>{program.ai_draft ? "AI draft" : program.is_active ? "Active" : "Not active"}</span>
              <p className="font-display uppercase text-xl leading-tight mt-0.5 break-words">{program.name}</p>
            </div>
            {stats.length > 0 && (
              <div className="flex gap-5 shrink-0">
                {stats.map((s) => (
                  <div key={s.label}>
                    <p className="font-display text-2xl leading-none [font-variant-numeric:tabular-nums]">{s.value}</p>
                    <p className="font-body text-[10px] text-steel uppercase tracking-wide mt-1">{s.label}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Link>
      )}
      <ClientProgramMenu programId={program.id} programName={program.name} clientName={clientName} isActive={program.is_active} aiDraft={!!program.ai_draft} onRename={() => setRenaming(true)} />
    </li>
  );
}
