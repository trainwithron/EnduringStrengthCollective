"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

// A quiet fold at the bottom of a client's Programs tab: the programs taken off their profile. "Put back" makes the program visible again; it stays inactive until the coach makes it active.
export function RemovedPrograms({ programs }: { programs: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (programs.length === 0) return null;

  async function putBack(id: string) {
    if (busyId) return;
    setBusyId(id);
    setError(null);
    const supabase = createBrowserClient();
    const { error: updateError } = await supabase.from("programs").update({ archived_at: null }).eq("id", id);
    setBusyId(null);
    if (updateError) {
      setError("Couldn't put it back. Try again.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="mt-4">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="min-h-11 font-body text-xs text-steel underline underline-offset-2">
        Removed programs ({programs.length})
      </button>
      {open && (
        <ul className="divide-y divide-steel/15 border-y border-steel/15">
          {programs.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 px-1">
              <span className="font-body text-sm text-steel truncate">{p.name}</span>
              <button type="button" disabled={busyId !== null} onClick={() => putBack(p.id)} className="min-h-11 px-3 font-body text-xs text-rust disabled:opacity-40 shrink-0">
                {busyId === p.id ? "Putting back…" : "Put back"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="font-body text-xs text-rust mt-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
