"use client";

import { useState } from "react";
import Link from "next/link";
import { ClientProgramMenu } from "@/components/coach/client-program-menu";
import { ProgramNameInput } from "@/components/coach/program-name-input";

// One program on a client's Programs tab: the name opens it; the three-dot menu renames it in place (this client's copy only), switches it active, or takes it off the profile.
export function ClientProgramRow({
  groupId,
  program,
  clientName,
}: {
  groupId: string;
  program: { id: string; name: string; is_active: boolean; ai_draft?: boolean };
  clientName: string;
}) {
  const [renaming, setRenaming] = useState(false);
  return (
    <li className="flex items-center">
      {renaming ? (
        <ProgramNameInput programId={program.id} initial={program.name} onDone={() => setRenaming(false)} className="flex-1 min-w-0 px-1 py-1" />
      ) : (
        <Link href={`/groups/${groupId}/programs/${program.id}`} className="flex flex-1 min-w-0 items-center justify-between gap-3 py-2.5 px-1 hover:bg-surface/60">
          <span className="font-body text-sm text-chalk truncate">{program.name}</span>
          <span className={`font-body text-xs shrink-0 ${program.ai_draft ? "text-rust" : program.is_active ? "text-positive" : "text-steel"}`}>{program.ai_draft ? "AI draft" : program.is_active ? "Active" : "Not active"}</span>
        </Link>
      )}
      <ClientProgramMenu programId={program.id} programName={program.name} clientName={clientName} isActive={program.is_active} aiDraft={!!program.ai_draft} onRename={() => setRenaming(true)} />
    </li>
  );
}
