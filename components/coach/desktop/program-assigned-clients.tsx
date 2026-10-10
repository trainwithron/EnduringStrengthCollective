"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";
import { assignedClients, type AssignedClient } from "@/lib/program-assigned-clients";

// The program's label under its name ("Coach Ron's program", "Robin's program"). Pressing it opens a small list, "Clients assigned to this program": everyone whose copy came from this
// program and the members of the group it is assigned to. Name only; a name opens that client's copy (or their profile when they have no copy).
export function ProgramAssignedClients({ programId, groupId, athleteId }: { programId: string; groupId: string; athleteId: string | null }) {
  const [label, setLabel] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [clients, setClients] = useState<AssignedClient[] | null>(null);
  const [failed, setFailed] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createBrowserClient();
    (async () => {
      // A client's own copy is labelled with the client; a shared program with the coach who made it.
      let personId = athleteId;
      if (!personId) {
        const { data } = await supabase.from("programs").select("created_by").eq("id", programId).maybeSingle();
        personId = (data as { created_by?: string | null } | null)?.created_by ?? null;
      }
      if (!personId) return;
      const { data: person } = await supabase.from("profiles").select("full_name").eq("id", personId).maybeSingle();
      const name = (person as { full_name?: string | null } | null)?.full_name?.trim();
      if (!cancelled && name) setLabel(`${name}'s program`);
    })();
    return () => {
      cancelled = true;
    };
  }, [programId, athleteId]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || clients) return;
    setFailed(false);
    const supabase = createBrowserClient();
    const [copiesRes, membersRes, personRes] = await Promise.all([
      supabase.from("programs").select("id, group_id, athlete_id, profiles!programs_athlete_id_fkey ( full_name )").eq("source_program_id", programId).not("athlete_id", "is", null).is("archived_at", null).limit(500),
      athleteId ? Promise.resolve({ data: [], error: null }) : supabase.from("group_memberships").select("profile_id, profiles ( full_name )").eq("group_id", groupId).eq("role", "athlete").limit(1000),
      athleteId ? supabase.from("profiles").select("id, full_name").eq("id", athleteId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    ]);
    if (copiesRes.error || membersRes.error) {
      setFailed(true);
      return;
    }
    const copies = ((copiesRes.data ?? []) as any[]).map((r) => ({ programId: r.id as string, groupId: r.group_id as string, athleteId: r.athlete_id as string, name: (r.profiles?.full_name ?? null) as string | null }));
    const members = ((membersRes.data ?? []) as any[]).map((r) => ({ id: r.profile_id as string, name: (r.profiles?.full_name ?? null) as string | null }));
    const person = personRes.data as { id: string; full_name: string | null } | null;
    if (person) members.push({ id: person.id, name: person.full_name });
    setClients(assignedClients({ groupId, copies, members }));
  }

  if (!label) return null;
  return (
    <div ref={boxRef} className="relative mt-2">
      <button type="button" onClick={() => void toggle()} aria-expanded={open} className="font-body text-sm text-rust underline underline-offset-2">
        {label}
      </button>
      {open && (
        <div role="dialog" aria-label="Clients assigned to this program" className="absolute z-20 left-0 top-full mt-1 w-64 max-h-72 overflow-y-auto border border-steel/30 bg-graphite p-3 shadow-lg">
          <p className="font-body text-xs text-steel mb-2">Clients assigned to this program</p>
          {failed ? (
            <p className="font-body text-xs text-rust">Couldn&apos;t load the list. Close this and try again.</p>
          ) : !clients ? (
            <p className="font-body text-xs text-steel">Loading…</p>
          ) : clients.length === 0 ? (
            <p className="font-body text-xs text-steel">No clients yet.</p>
          ) : (
            <ul className="space-y-1">
              {clients.map((c) => (
                <li key={c.id}>
                  <Link href={c.href} className="font-body text-sm text-chalk hover:text-rust">
                    {c.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
