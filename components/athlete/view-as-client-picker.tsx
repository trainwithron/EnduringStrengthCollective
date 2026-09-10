"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { X, Search } from "lucide-react";

interface ClientOption {
  id: string;
  fullName: string;
  groupId: string;
}

// Full-screen, coach-wide (not scoped to one group) — a coach may have
// clients spread across several groups, so this lists every athlete they
// coach anywhere, same shape FitPros' own "View As Client" picker uses.
export function ViewAsClientPicker({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [clients, setClients] = useState<ClientOption[] | null>(null);
  const [query, setQuery] = useState("");
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: coachedGroups } = await supabase
        .from("group_memberships")
        .select("group_id")
        .eq("profile_id", user.id)
        .eq("role", "coach");
      const groupIds = (coachedGroups ?? []).map((g) => g.group_id);
      if (groupIds.length === 0) {
        if (!cancelled) setClients([]);
        return;
      }

      const { data } = await supabase
        .from("group_memberships")
        .select("group_id, profile_id, profiles ( id, full_name )")
        .in("group_id", groupIds)
        .eq("role", "athlete");

      if (cancelled) return;
      const seen = new Set<string>();
      const options: ClientOption[] = [];
      for (const row of (data ?? []) as any[]) {
        const id = row.profiles?.id;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        options.push({ id, fullName: row.profiles?.full_name ?? "Client", groupId: row.group_id });
      }
      options.sort((a, b) => a.fullName.localeCompare(b.fullName));
      setClients(options);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  async function selectClient(client: ClientOption) {
    if (switching) return;
    setSwitching(true);
    await fetch("/api/coach/act-as", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ athleteId: client.id, groupId: client.groupId }),
    });
    onClose();
    router.push(`/groups/${client.groupId}`);
    router.refresh();
  }

  const filtered = (clients ?? []).filter((c) =>
    c.fullName.toLowerCase().includes(query.trim().toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-40 bg-graphite text-chalk font-body flex flex-col">
      <header className="px-5 pt-8 pb-4 border-b border-steel/20 flex items-center justify-between gap-3">
        <h1 className="font-display font-bold text-2xl uppercase leading-none">View as Client</h1>
        <button type="button" onClick={onClose} aria-label="Close" className="text-steel active:text-rust">
          <X className="w-5 h-5" strokeWidth={2.5} />
        </button>
      </header>

      <div className="px-5 py-3 border-b border-steel/20 flex items-center gap-2">
        <Search className="w-4 h-4 text-steel shrink-0" />
        <input
          type="text"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search clients…"
          className="flex-1 h-9 bg-transparent text-chalk font-body text-sm focus:outline-none"
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {clients === null && (
          <p className="font-body text-sm text-steel px-5 py-4">Loading…</p>
        )}
        {clients?.length === 0 && (
          <p className="font-body text-sm text-steel px-5 py-4">No clients yet.</p>
        )}
        {filtered.map((c) => (
          <button
            key={c.id}
            type="button"
            disabled={switching}
            onClick={() => selectClient(c)}
            className="w-full text-left px-5 py-4 border-b border-steel/10 font-body text-base disabled:opacity-50 active:bg-surface/60"
          >
            {c.fullName}
          </button>
        ))}
      </div>
    </div>
  );
}
