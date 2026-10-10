"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { duplicateProgram } from "@/lib/program-duplication";
import { localDateKey } from "@/lib/timezone";
import { orderForAssign, programLabel, SEARCH_FROM, type PickableProgram } from "@/lib/assign-picker";
import { SearchPickList } from "@/components/coach/search-pick-list";

// The two things a coach does from a client's Programs tab, as plain buttons above the client's list: Assign program (pick any program of theirs, one click assigns it with the same copy
// engine as everywhere else, no confirmation) and Build with AI. An unsigned AI draft is listed but cannot be picked until it is signed off.
export function ClientProgramActions({ groupId, athleteId, athleteFullName, extra }: { groupId: string; athleteId: string; athleteFullName: string; extra?: ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [programs, setPrograms] = useState<(PickableProgram & { uses: number })[] | null>(null);
  const [startDate, setStartDate] = useState(localDateKey());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function openPicker() {
    setOpen(true);
    setDone(null);
    setError(null);
    if (programs) return;
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error: loadError } = await supabase
      .from("programs")
      .select("id, name, created_at, ai_draft, source_program_id, profiles!programs_athlete_id_fkey ( full_name )")
      .eq("created_by", user.id)
      .order("created_at", { ascending: false })
      .limit(300);
    if (loadError) {
      setError("Couldn't load your programs. Try again.");
      setPrograms([]);
      return;
    }
    setPrograms(
      orderForAssign(
        ((data ?? []) as any[]).map((p) => ({
          id: p.id as string,
          name: p.name as string,
          createdAt: p.created_at as string,
          aiDraft: p.ai_draft === true,
          clientName: (p.profiles?.full_name as string | undefined) ?? null,
          sourceProgramId: (p.source_program_id as string | null) ?? null,
        }))
      )
    );
  }

  async function assign(program: PickableProgram) {
    if (busyId || program.aiDraft) return;
    setBusyId(program.id);
    setError(null);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusyId(null);
      return;
    }
    const result = await duplicateProgram(supabase, {
      sourceProgramId: program.id,
      destinationGroupId: groupId,
      createdBy: user.id,
      athleteId,
      clientName: athleteFullName,
      startDate: startDate || undefined,
    });
    setBusyId(null);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    // It is in the list below at once; say what happened and close the picker.
    setDone(`Assigned "${program.name}" to ${athleteFullName}. It is in their list below.`);
    setOpen(false);
    router.refresh();
  }

  const button = "inline-flex items-center justify-center min-h-11 sm:h-9 px-3 font-body text-xs border";
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => (open ? setOpen(false) : void openPicker())} aria-expanded={open} className={`${button} text-rust border-rust`}>
          Assign program
        </button>
        <button type="button" onClick={() => router.push(`/groups/${groupId}/programs/new?method=ai&athleteId=${athleteId}`)} className={`${button} text-chalk border-steel/40`}>
          Build with AI
        </button>
        {extra}
      </div>
      {done && (
        <p className="font-body text-xs text-positive mt-2" role="status">
          {done}
        </p>
      )}
      {open && (
        <div className="mt-3 border border-steel/25 bg-surface/40 p-3" aria-label="Assign which program?">
          <p className="font-body text-xs text-steel uppercase tracking-wide mb-2">Assign which program?</p>
          <label className="block font-body text-xs text-steel mb-2">
            Start date
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="block w-full sm:w-48 h-11 sm:h-8 mt-1 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs focus:outline-none focus:border-rust" />
          </label>
          {error && (
            <p className="font-body text-xs text-rust mb-2" role="alert">
              {error}
            </p>
          )}
          <SearchPickList
            items={programs ? programs.map((p) => ({ key: p.id, label: p.name, sub: programLabel(p), disabled: p.aiDraft })) : null}
            onPick={(id) => {
              const p = programs?.find((x) => x.id === id);
              if (p) void assign(p);
            }}
            busyKey={busyId}
            emptyText="You have no programs yet."
            searchFrom={SEARCH_FROM}
            searchLabel="Search your programs"
          />
        </div>
      )}
    </div>
  );
}
