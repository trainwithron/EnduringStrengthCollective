"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { Eye, ChevronDown } from "lucide-react";

interface ClientOption {
  id: string;
  fullName: string;
}

// A fast, always-visible jump to one client's profile — where "Log
// in-person session" (the real, already-safe workout-completion flow,
// same set-by-set logging UI the athlete uses, tagged coach-logged) and
// "Calendar" already live. Lets a coach pick a client and confirm things
// look right on their end without hunting through Clients → their row.
export function ViewAsClientButton({ groupId }: { groupId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [clients, setClients] = useState<ClientOption[] | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || clients) return;
    let cancelled = false;
    async function run() {
      const supabase = createBrowserClient();
      const { data } = await supabase
        .from("group_memberships")
        .select("profile_id, profiles ( id, full_name )")
        .eq("group_id", groupId)
        .eq("role", "athlete");
      if (cancelled) return;
      const options = (data ?? [])
        .map((row: any) => ({ id: row.profiles?.id, fullName: row.profiles?.full_name }))
        .filter((c): c is ClientOption => !!c.id)
        .sort((a, b) => a.fullName.localeCompare(b.fullName));
      setClients(options);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [open, clients, groupId]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  function selectClient(clientId: string) {
    setOpen(false);
    router.push(`/groups/${groupId}/athletes/${clientId}`);
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="View as Client"
        className="flex items-center gap-1.5 h-9 px-2.5 md:px-3 border border-steel/30 text-chalk active:border-rust active:text-rust transition-colors"
      >
        <Eye className="w-4 h-4 shrink-0" strokeWidth={2.25} />
        <span className="font-body text-sm hidden sm:inline">View as Client</span>
        <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-64 max-w-[85vw] bg-surface border border-steel/30 z-30 shadow-lg">
          <p className="font-body text-[11px] text-steel uppercase tracking-wide px-3 pt-2.5 pb-1.5">
            View a client&apos;s profile
          </p>
          <div className="max-h-72 overflow-y-auto">
            {clients === null && (
              <p className="font-body text-xs text-steel px-3 py-2.5">Loading…</p>
            )}
            {clients?.length === 0 && (
              <p className="font-body text-xs text-steel px-3 py-2.5">No clients in this group yet.</p>
            )}
            {clients?.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => selectClient(c.id)}
                className="w-full text-left px-3 py-2.5 font-body text-sm text-chalk hover:bg-graphite/50"
              >
                {c.fullName}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
