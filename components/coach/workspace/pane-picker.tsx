"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import { dedupeClients, type FinderClient } from "@/lib/client-finder";
import { clientDestinations, pageDestinations, searchDestinations, type WorkspaceDestination } from "@/lib/workspace-destinations";
import { useWorkspace } from "./workspace-context";

// "Add a view": type what you want next to your page (Calendar, Business, a client's name, "maria messages") and pick it. Enter puts it in the panel; Shift+Enter
// (or the Card button) floats it as a card. With nothing typed, the views you used last come first. There are no fixed presets.
export function PanePicker() {
  const ws = useWorkspace();
  const open = !!ws?.pickerOpen;
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [clients, setClients] = useState<FinderClient[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement as HTMLElement | null;
    setQuery("");
    setActive(0);
    setTimeout(() => inputRef.current?.focus(), 0);
    return () => returnFocus.current?.focus?.();
  }, [open]);

  // The coach's clients, loaded the first time the picker opens (the same lookup the client finder uses).
  useEffect(() => {
    if (!open || clients) return;
    let cancelled = false;
    (async () => {
      const supabase = createBrowserClient();
      const { data: auth } = await supabase.auth.getUser();
      const me = auth.user?.id;
      if (!me) return;
      const { data: mine } = await supabase.from("group_memberships").select("group_id").eq("profile_id", me).eq("role", "coach");
      const groupIds = (mine ?? []).map((m: { group_id: string }) => m.group_id);
      if (groupIds.length === 0) {
        if (!cancelled) setClients([]);
        return;
      }
      const { data } = await supabase.from("group_memberships").select("group_id, profiles ( id, full_name ), groups ( name, group_kind )").in("group_id", groupIds).eq("role", "athlete");
      if (cancelled) return;
      const rows: FinderClient[] = (data ?? [])
        .map((r: any) => ({
          id: r.profiles?.id as string,
          fullName: (r.profiles?.full_name as string) ?? "",
          groupId: r.group_id as string,
          groupName: r.groups?.group_kind === "one_on_one" ? null : ((r.groups?.name as string | null) ?? null),
        }))
        .filter((r: FinderClient) => r.id && r.fullName);
      setClients(dedupeClients(rows, ws?.groupId ?? null));
    })();
    return () => {
      cancelled = true;
    };
  }, [open, clients, ws?.groupId]);

  const all = useMemo<WorkspaceDestination[]>(() => {
    if (!ws) return [];
    const pages = pageDestinations(ws.groupId, ws.isShared);
    const people = (clients ?? []).flatMap((c) => clientDestinations({ athleteId: c.id, name: c.fullName, groupId: c.groupId }));
    return [...pages, ...people];
  }, [ws, clients]);

  const results = useMemo(() => {
    if (query.trim() === "" && ws && ws.layout.recents.length > 0) return ws.layout.recents;
    return searchDestinations(all, query, 12);
  }, [all, query, ws]);

  useEffect(() => setActive(0), [query]);

  if (!ws || !open) return null;
  const showingRecents = query.trim() === "" && ws.layout.recents.length > 0;

  function choose(dest: WorkspaceDestination, where: "dock" | "floating") {
    ws!.openDest(dest, where);
    ws!.setPickerOpen(false);
  }
  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      ws!.setPickerOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      choose(results[active], e.shiftKey ? "floating" : "dock");
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center pt-[12vh] px-4 bg-black/50" onMouseDown={(e) => e.target === e.currentTarget && ws.setPickerOpen(false)}>
      <div role="dialog" aria-modal="true" aria-label="Add a view to your workspace" className="w-full max-w-xl bg-surface border border-steel/30 shadow-xl" onKeyDown={onKey}>
        <div className="flex items-center gap-2 px-3 border-b border-steel/20">
          <Search className="w-4 h-4 text-steel shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls="workspace-picker-list"
            aria-activedescendant={results[active] ? `workspace-picker-${active}` : undefined}
            aria-label="Search pages and clients"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Calendar, Business, a client's name…"
            className="flex-1 h-12 bg-transparent text-chalk font-body text-sm focus:outline-none"
          />
        </div>
        <p className="px-3 pt-2 font-body text-xs text-steel">{showingRecents ? "Recent" : results.length === 0 ? "" : "Matches"}. Enter puts it in the panel; Shift+Enter makes it a card.</p>
        <ul id="workspace-picker-list" role="listbox" className="max-h-[50vh] overflow-y-auto py-1">
          {results.map((d, i) => (
            <li
              key={d.id}
              id={`workspace-picker-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              className={`flex items-center gap-2 px-3 min-h-[44px] ${i === active ? "bg-rust/10" : ""}`}
            >
              <button type="button" onClick={() => choose(d, "dock")} className="flex-1 min-w-0 text-left py-2">
                <span className="block font-body text-sm text-chalk truncate">{d.label}</span>
                <span className="block font-body text-xs text-steel truncate">{d.section}</span>
              </button>
              <button type="button" onClick={() => choose(d, "dock")} className="h-9 px-3 border border-steel/40 text-chalk font-body text-xs shrink-0">
                Panel
              </button>
              <button type="button" onClick={() => choose(d, "floating")} className="h-9 px-3 border border-steel/40 text-chalk font-body text-xs shrink-0">
                Card
              </button>
            </li>
          ))}
          {results.length === 0 && <li className="px-3 py-4 font-body text-sm text-steel">{clients === null ? "Looking…" : "Nothing matches. Try a page name or a client's name."}</li>}
        </ul>
      </div>
    </div>
  );
}
