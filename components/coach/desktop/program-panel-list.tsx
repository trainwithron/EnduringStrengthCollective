"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { useOrgGroupIds } from "@/lib/use-org-group-ids";
import { useTerm } from "@/components/coach/terminology-provider";
import { clientIdFromPath, panelProgramLabel, panelPrograms, type PanelProgramRow } from "@/lib/program-panel";

// The side panel's Program tab: the coach's active programs (and unsigned AI drafts), one tap to open each, and a clear way to build a new one. Inside a client's profile that
// client's own programs come first. The same programs, in the same words, as the Programs page and the client's Programs tab.
export function ProgramPanelList({ groupId }: { groupId: string }) {
  const term = useTerm();
  const pathname = usePathname();
  const clientId = clientIdFromPath(pathname);
  const orgGroupIds = useOrgGroupIds(groupId);
  const [rows, setRows] = useState<PanelProgramRow[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error: loadError } = await supabase
        .from("programs")
        .select("id, name, group_id, athlete_id, is_active, ai_draft, created_at, profiles!programs_athlete_id_fkey ( full_name )")
        .eq("created_by", user.id)
        .is("archived_at", null)
        .or("is_active.eq.true,ai_draft.eq.true")
        .order("created_at", { ascending: false })
        .limit(300);
      if (cancelled) return;
      if (loadError) {
        setError(true);
        setRows([]);
        return;
      }
      setRows(
        ((data ?? []) as any[]).map((p) => ({
          id: p.id,
          name: p.name,
          groupId: p.group_id,
          athleteId: p.athlete_id ?? null,
          clientName: p.profiles?.full_name ?? null,
          isActive: !!p.is_active,
          aiDraft: !!p.ai_draft,
          createdAt: p.created_at,
        }))
      );
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // A client's own copies may be inactive too (the program they followed before): those are read apart so the list can show them under the active one.
  const [clientRows, setClientRows] = useState<PanelProgramRow[]>([]);
  useEffect(() => {
    setClientRows([]);
    if (!clientId) return;
    let cancelled = false;
    async function loadClient() {
      const supabase = createBrowserClient();
      const { data } = await supabase
        .from("programs")
        .select("id, name, group_id, athlete_id, is_active, ai_draft, created_at, profiles!programs_athlete_id_fkey ( full_name )")
        .eq("athlete_id", clientId!)
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(20);
      if (cancelled) return;
      setClientRows(
        ((data ?? []) as any[]).map((p) => ({
          id: p.id,
          name: p.name,
          groupId: p.group_id,
          athleteId: p.athlete_id ?? null,
          clientName: p.profiles?.full_name ?? null,
          isActive: !!p.is_active,
          aiDraft: !!p.ai_draft,
          createdAt: p.created_at,
        }))
      );
    }
    loadClient();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const merged = (() => {
    if (!rows) return null;
    const seen = new Set(rows.map((r) => r.id));
    return [...rows, ...clientRows.filter((r) => !seen.has(r.id))];
  })();
  const view = merged ? panelPrograms(merged, clientId, orgGroupIds) : null;
  const clientName = clientRows[0]?.clientName ?? view?.forClient[0]?.clientName ?? null;

  const row = "block min-h-11 px-2 py-1.5 hover:bg-surface/40 active:bg-surface/60";
  const open = (r: PanelProgramRow) => `/groups/${r.groupId}/programs/${r.id}`;

  const list = (items: PanelProgramRow[]) => (
    <div className="space-y-0.5">
      {items.map((r) => (
        <Link key={r.id} href={open(r)} className={row}>
          <span className="block font-body text-sm text-chalk truncate">{r.name}</span>
          <span className={`block font-body text-xs truncate ${r.aiDraft ? "text-rust" : "text-steel"}`}>{panelProgramLabel(r)}</span>
        </Link>
      ))}
    </div>
  );

  return (
    <div>
      <Link href={`/groups/${groupId}/programs/new`} className="flex items-center justify-center min-h-11 mb-3 bg-rust text-graphite font-body text-sm font-medium">
        Build a program
      </Link>

      {view === null && <p className="font-body text-xs text-steel px-1">Loading…</p>}
      {error && <p className="font-body text-xs text-rust px-1">Couldn&apos;t load your programs. Try again in a moment.</p>}

      {view && view.forClient.length > 0 && (
        <div className="mb-3">
          <p className="font-body text-xs text-steel uppercase tracking-wide mb-1 px-1">{clientName ? `${clientName}'s programs` : `This ${term("client")}'s programs`}</p>
          {list(view.forClient)}
        </div>
      )}

      {view && (
        <div>
          {view.forClient.length > 0 && view.others.length > 0 && <p className="font-body text-xs text-steel uppercase tracking-wide mb-1 px-1">Your other programs</p>}
          {view.others.length > 0 ? (
            list(view.others)
          ) : view.forClient.length === 0 && !error ? (
            <p className="font-body text-xs text-steel px-1">No active programs yet.</p>
          ) : null}
          {view.moreCount > 0 && (
            <Link href="/programs" className="block min-h-11 px-2 py-3 font-body text-xs text-rust">
              See all programs ({view.moreCount} more) &rarr;
            </Link>
          )}
          {view.moreCount === 0 && view.others.length > 0 && (
            <Link href="/programs" className="block min-h-11 px-2 py-3 font-body text-xs text-steel">
              All programs &rarr;
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
