"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Plus } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";

interface WorkspaceGroup {
  id: string;
  name: string;
  kind: "team" | "social";
}

// The business name in the top bar, as a real menu. It lists coach-level places first (Home, all clients), then the coach's team and social
// groups (one-on-one client groups are NOT listed: clients are reached through Clients), then other organizations only when the coach belongs
// to two or more, and a way to create a group. Opening a group goes to that group's page; the rail stays coach-level.
export function WorkspaceMenu({ groupId, orgName }: { groupId: string; orgName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<WorkspaceGroup[]>([]);
  const [otherOrgs, setOtherOrgs] = useState<{ id: string; name: string; groupId: string }[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<"team" | "social">("team");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function load() {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("group_memberships")
        .select("groups ( id, name, group_kind, organization_id, organizations ( name ) )")
        .eq("profile_id", user.id)
        .eq("role", "coach");
      const rows = ((data ?? []) as any[]).map((r) => r.groups).filter(Boolean);
      const current = rows.find((g) => g.id === groupId);
      const currentOrgId = current?.organization_id ?? null;
      if (cancelled) return;
      setGroups(
        rows
          .filter((g) => g.group_kind !== "one_on_one" && (currentOrgId == null || g.organization_id === currentOrgId))
          .map((g) => ({ id: g.id as string, name: (g.name as string) ?? "Group", kind: (g.group_kind === "social" ? "social" : "team") as "team" | "social" }))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
      // Other organizations only appear for a coach who belongs to two or more.
      const orgs = new Map<string, { id: string; name: string; groupId: string }>();
      for (const g of rows) {
        if (g.organization_id && g.organization_id !== currentOrgId && !orgs.has(g.organization_id)) {
          orgs.set(g.organization_id, { id: g.organization_id, name: g.organizations?.name ?? "Organization", groupId: g.id });
        }
      }
      setOtherOrgs([...orgs.values()].sort((a, b) => a.name.localeCompare(b.name)));
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [open, groupId]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function createGroup() {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    setError(null);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusy(false);
      return;
    }
    const { data: current } = await supabase.from("groups").select("organization_id").eq("id", groupId).maybeSingle();
    if (!current?.organization_id) {
      setBusy(false);
      setError("Couldn't find your organization. Try again.");
      return;
    }
    // Generated here rather than read back after the insert: a new group has no membership row yet, so it cannot be selected back.
    const newGroupId = crypto.randomUUID();
    const { error: groupError } = await supabase
      .from("groups")
      .insert({ id: newGroupId, name, created_by: user.id, organization_id: current.organization_id, group_kind: newKind });
    if (groupError) {
      setBusy(false);
      setError("Couldn't create the group. Try again.");
      return;
    }
    await supabase.from("group_memberships").insert({ group_id: newGroupId, profile_id: user.id, role: "coach" });
    setBusy(false);
    setOpen(false);
    router.push(`/groups/${newGroupId}/dashboard`);
  }

  const itemClass = "flex items-center h-10 px-3 font-body text-sm text-chalk hover:bg-surface active:text-rust w-full text-left";

  return (
    <div className="relative min-w-0" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={orgName}
        className="flex items-center gap-1 min-w-0 font-body text-xs md:text-sm text-steel hover:text-chalk"
      >
        <span className="truncate max-w-[10rem] md:max-w-[16rem]">{orgName}</span>
        <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-full mt-1 z-50 w-72 max-w-[calc(100vw-2rem)] bg-surface border border-steel/30 shadow-lg max-h-[70vh] overflow-y-auto">
          <Link href="/dashboard" role="menuitem" onClick={() => setOpen(false)} className={itemClass}>
            Home
          </Link>
          <Link href={`/groups/${groupId}/clients`} role="menuitem" onClick={() => setOpen(false)} className={itemClass}>
            All clients
          </Link>
          {groups.length > 0 && (
            <>
              <p className="px-3 pt-2 pb-1 font-body text-xs text-steel uppercase tracking-wide">Groups</p>
              {groups.map((g) => (
                <Link
                  key={g.id}
                  href={`/groups/${g.id}/dashboard`}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className={`${itemClass} justify-between`}
                >
                  <span className="truncate">{g.name}</span>
                  {g.kind === "social" && <span className="font-body text-xs text-steel shrink-0 ml-2">Social</span>}
                </Link>
              ))}
            </>
          )}
          {otherOrgs.length > 0 && (
            <>
              <p className="px-3 pt-2 pb-1 font-body text-xs text-steel uppercase tracking-wide">Other organizations</p>
              {otherOrgs.map((o) => (
                <Link key={o.id} href={`/groups/${o.groupId}/dashboard`} role="menuitem" onClick={() => setOpen(false)} className={itemClass}>
                  <span className="truncate">{o.name}</span>
                </Link>
              ))}
            </>
          )}
          <div className="border-t border-steel/20 mt-1">
            {!creating ? (
              <button type="button" onClick={() => setCreating(true)} className={itemClass}>
                <Plus className="w-4 h-4 mr-2 shrink-0 text-steel" />
                Create group
              </button>
            ) : (
              <div className="p-3 space-y-2">
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") createGroup();
                  }}
                  placeholder="Group name"
                  className="w-full h-10 bg-graphite border border-steel/30 text-chalk px-2 font-body text-base sm:text-sm"
                />
                <select
                  value={newKind}
                  onChange={(e) => setNewKind(e.target.value as "team" | "social")}
                  className="w-full h-10 bg-graphite border border-steel/30 text-chalk px-2 font-body text-base sm:text-sm"
                >
                  <option value="team">Group with a shared program</option>
                  <option value="social">Social group (community only)</option>
                </select>
                {error && (
                  <p className="font-body text-xs text-rust" role="alert">
                    {error}
                  </p>
                )}
                <button
                  type="button"
                  onClick={createGroup}
                  disabled={busy || !newName.trim()}
                  className="w-full h-10 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
                >
                  {busy ? "Creating…" : "Create"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
