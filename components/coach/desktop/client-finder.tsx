"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import { dedupeClients, rankClientMatches, type FinderClient } from "@/lib/client-finder";
import { useTerminology } from "@/components/coach/terminology-provider";
import { resolveTerm } from "@/lib/terminology";

// The one way to get to a client from anywhere: type part of a name, arrow to one, press Enter. Searches every client the coach has, across
// all their groups, and opens that client's profile. Also opens with Ctrl/Cmd+K.
export function ClientFinder({ currentGroupId, align = "right" }: { currentGroupId: string | null; align?: "right" | "left" }) {
  const router = useRouter();
  const { overrides } = useTerminology();
  const clientWord = resolveTerm(overrides, "client", "singular");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [clients, setClients] = useState<FinderClient[] | null>(null);
  const [error, setError] = useState(false);
  const [active, setActive] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => rankClientMatches(query, clients ?? []), [query, clients]);
  // A group name only helps when the coach has more than one group to tell apart.
  const showGroupNames = useMemo(() => new Set((clients ?? []).map((c) => c.groupId)).size > 1, [clients]);

  useEffect(() => {
    if (!open || clients) return;
    let cancelled = false;
    (async () => {
      const supabase = createBrowserClient();
      const { data: auth } = await supabase.auth.getUser();
      const me = auth.user?.id;
      if (!me) return;
      const { data: mine } = await supabase.from("group_memberships").select("group_id").eq("profile_id", me).eq("role", "coach");
      const groupIds = (mine ?? []).map((m: any) => m.group_id as string);
      if (groupIds.length === 0) {
        if (!cancelled) setClients([]);
        return;
      }
      const { data, error: queryError } = await supabase
        .from("group_memberships")
        .select("group_id, profiles ( id, full_name ), groups ( name, group_kind )")
        .in("group_id", groupIds)
        .eq("role", "athlete");
      if (cancelled) return;
      if (queryError) {
        setError(true);
        return;
      }
      const rows: FinderClient[] = (data ?? [])
        .map((r: any) => ({
          id: r.profiles?.id as string,
          fullName: (r.profiles?.full_name as string) ?? "",
          groupId: r.group_id as string,
          // A one-on-one group is named after the client; only a team's name helps tell people apart.
          groupName: r.groups?.group_kind === "one_on_one" ? null : (r.groups?.name as string | null) ?? null,
        }))
        .filter((r) => r.id && r.fullName);
      setClients(dedupeClients(rows, currentGroupId));
    })();
    return () => {
      cancelled = true;
    };
  }, [open, clients, currentGroupId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClickOutside);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClickOutside);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setActive(0);
      // Wait for the input to exist.
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setQuery("");
    }
  }, [open]);

  useEffect(() => setActive(0), [query]);

  function go(c: FinderClient) {
    setOpen(false);
    router.push(`/groups/${c.groupId}/athletes/${c.id}`);
  }

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, Math.max(0, matches.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && matches[active]) {
      e.preventDefault();
      go(matches[active]);
    }
  }

  const label = `Find a ${clientWord.toLowerCase()}`;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        className="flex items-center gap-1.5 h-9 px-2.5 md:px-3 border border-steel/30 text-chalk active:border-rust active:text-rust transition-colors"
      >
        <Search className="w-4 h-4 shrink-0" strokeWidth={2.25} />
        <span className="font-body text-sm hidden sm:inline">{label}</span>
      </button>

      {open && (
        <div role="dialog" aria-label={label} className={`absolute ${align === "right" ? "right-0" : "left-0"} top-full mt-1 w-72 max-w-[85vw] bg-surface border border-steel/30 z-30 shadow-lg`}>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Start typing a name"
            aria-label="Name"
            role="combobox"
            aria-expanded="true"
            aria-controls="client-finder-results"
            aria-activedescendant={matches[active] ? `client-finder-${matches[active].id}` : undefined}
            className="w-full bg-transparent px-3 py-2.5 font-body text-sm text-chalk border-b border-steel/20 outline-none placeholder:text-steel"
          />
          <ul id="client-finder-results" role="listbox" className="max-h-72 overflow-y-auto">
            {clients === null && !error && <li className="font-body text-xs text-steel px-3 py-2.5">Loading…</li>}
            {error && <li className="font-body text-xs text-steel px-3 py-2.5">Couldn&apos;t load your clients. Try again in a moment.</li>}
            {clients && matches.length === 0 && (
              <li className="font-body text-xs text-steel px-3 py-2.5">{query.trim() ? `No one matches "${query.trim()}".` : "No clients yet."}</li>
            )}
            {matches.map((c, i) => (
              <li key={c.id} id={`client-finder-${c.id}`} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onClick={() => go(c)}
                  onMouseEnter={() => setActive(i)}
                  className={`w-full text-left px-3 py-2.5 font-body text-sm text-chalk flex items-baseline justify-between gap-2 ${i === active ? "bg-graphite/60" : ""}`}
                >
                  <span className="truncate">{c.fullName}</span>
                  {showGroupNames && c.groupName && <span className="text-xs text-steel shrink-0 truncate max-w-[40%]">{c.groupName}</span>}
                </button>
              </li>
            ))}
          </ul>
          <p className="font-body text-xs text-steel px-3 py-2 border-t border-steel/15">Ctrl+K opens this anywhere</p>
        </div>
      )}
    </div>
  );
}
