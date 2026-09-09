"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { ChevronDown, Plus, Search, Pencil } from "lucide-react";

interface OrgGroup {
  id: string;
  name: string;
  focusTag: string | null;
}

// Lets a coach jump between every group they run without signing out —
// either every group in their organization (if they're an owner/admin),
// or just the groups they personally coach otherwise. Shows nothing for
// a coach who only ever runs one group: `groups` stays null and the
// header renders as it always did.
export function GroupSwitcher({
  groupId,
  groupName,
  collapsed = false,
}: {
  groupId: string;
  groupName: string;
  collapsed?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<OrgGroup[] | null>(null);
  const [switching, setSwitching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [filterQuery, setFilterQuery] = useState("");
  const [editingTagFor, setEditingTagFor] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const [{ data: membership }, { data: coachedRows }] = await Promise.all([
        supabase
          .from("organization_memberships")
          .select("organization_id, role")
          .eq("profile_id", user.id)
          .maybeSingle(),
        supabase
          .from("group_memberships")
          .select("groups ( id, name, focus_tag )")
          .eq("profile_id", user.id)
          .eq("role", "coach"),
      ]);

      const byId = new Map<string, OrgGroup>();
      for (const row of coachedRows ?? []) {
        const g = (row as any).groups;
        if (g) byId.set(g.id, { id: g.id, name: g.name, focusTag: g.focus_tag ?? null });
      }

      if (membership && (membership.role === "owner" || membership.role === "admin")) {
        const { data: orgGroups } = await supabase
          .from("groups")
          .select("id, name, focus_tag")
          .eq("organization_id", membership.organization_id)
          .order("name");
        for (const g of orgGroups ?? []) {
          byId.set(g.id, { id: g.id, name: g.name, focusTag: g.focus_tag ?? null });
        }
      }

      // Only worth showing once there's actually more than one group to
      // jump between — a coach running exactly one group sees the plain
      // static header, unchanged from before this existed.
      if (!cancelled && byId.size > 1) {
        setGroups([...byId.values()].sort((a, b) => a.name.localeCompare(b.name)));
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  async function persistTag(targetGroupId: string, tag: string) {
    const supabase = createBrowserClient();
    await supabase.from("groups").update({ focus_tag: tag.trim() || null }).eq("id", targetGroupId);
    setGroups((prev) =>
      prev ? prev.map((g) => (g.id === targetGroupId ? { ...g, focusTag: tag.trim() || null } : g)) : prev
    );
    setEditingTagFor(null);
  }

  const filteredGroups = (groups ?? []).filter((g) => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return true;
    return g.name.toLowerCase().includes(q) || (g.focusTag ?? "").toLowerCase().includes(q);
  });

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  async function switchTo(targetGroupId: string) {
    if (targetGroupId === groupId || switching) return;
    setSwitching(true);
    setError(null);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSwitching(false);
      return;
    }

    // Already staffing this group — just go. Otherwise, self-provision a
    // real coach membership (RLS permits this specifically for an org
    // owner/admin switching within their own org) so every existing
    // coach-only check — RLS and the page-level role lookups alike —
    // treats this group exactly like any other they coach, from here on.
    const { data: existing } = await supabase
      .from("group_memberships")
      .select("group_id")
      .eq("group_id", targetGroupId)
      .eq("profile_id", user.id)
      .maybeSingle();

    if (!existing) {
      const { error: insertError } = await supabase
        .from("group_memberships")
        .insert({ group_id: targetGroupId, profile_id: user.id, role: "coach" });
      if (insertError) {
        setSwitching(false);
        setError("Couldn't switch — try again.");
        return;
      }
    }

    router.push(`/groups/${targetGroupId}/dashboard`);
  }

  async function handleCreateGroup() {
    const trimmed = newName.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    setError(null);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setCreating(false);
      return;
    }

    const { data: membership } = await supabase
      .from("organization_memberships")
      .select("organization_id")
      .eq("profile_id", user.id)
      .maybeSingle();
    if (!membership) {
      setCreating(false);
      return;
    }

    // Generated client-side rather than read back via .select() after
    // insert — a fresh group has no group_memberships row yet, so the
    // table's own SELECT policy (membership-gated) can't see it, and
    // Postgres rejects an INSERT ... RETURNING whose row fails the
    // SELECT policy check outright, not just the RETURNING data.
    const newGroupId = crypto.randomUUID();
    const { error: groupError } = await supabase
      .from("groups")
      .insert({ id: newGroupId, name: trimmed, created_by: user.id, organization_id: membership.organization_id });

    if (groupError) {
      setCreating(false);
      setError("Couldn't create the group — try again.");
      return;
    }

    await supabase
      .from("group_memberships")
      .insert({ group_id: newGroupId, profile_id: user.id, role: "coach" });

    router.push(`/groups/${newGroupId}/dashboard`);
  }

  const initials = groupName
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  // Not an org owner/admin (or still resolving) — the plain static header,
  // unchanged from before this feature existed.
  if (!groups) {
    if (collapsed) {
      return (
        <div className="h-16 flex items-center justify-center border-b border-steel/20" title={groupName}>
          <span className="font-display font-bold text-sm">{initials}</span>
        </div>
      );
    }
    return (
      <div className="px-5 pt-6 pb-5 border-b border-steel/20">
        <p className="font-body text-[11px] text-steel uppercase tracking-wide">Coaching</p>
        <h1 className="font-display font-bold text-lg uppercase leading-tight mt-1">{groupName}</h1>
      </div>
    );
  }

  if (collapsed) {
    return (
      <div className="relative" ref={containerRef}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="h-16 w-full flex items-center justify-center border-b border-steel/20"
          title={groupName}
        >
          <span className="font-display font-bold text-sm">{initials}</span>
        </button>
        {open && (
          <div className="absolute left-full top-0 ml-1 w-64 bg-surface border border-steel/30 z-20 shadow-lg">
            {groups.length > 3 && (
              <div className="p-2 border-b border-steel/20">
                <input
                  type="text"
                  value={filterQuery}
                  onChange={(e) => setFilterQuery(e.target.value)}
                  placeholder="Filter groups…"
                  autoFocus
                  className="w-full h-8 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs focus:outline-none focus:border-rust"
                />
              </div>
            )}
            <div className="max-h-64 overflow-y-auto">
              {filteredGroups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => switchTo(g.id)}
                  disabled={switching}
                  className={`w-full text-left px-3 py-2.5 font-body text-sm disabled:opacity-50 ${
                    g.id === groupId ? "text-rust bg-rust/10" : "text-chalk hover:bg-graphite/50"
                  }`}
                >
                  {g.name}
                  {g.focusTag && <span className="text-steel"> · {g.focusTag}</span>}
                </button>
              ))}
              {filteredGroups.length === 0 && (
                <p className="px-3 py-2.5 font-body text-xs text-steel">No groups match.</p>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="px-5 pt-6 pb-5 border-b border-steel/20 relative" ref={containerRef}>
      <p className="font-body text-[11px] text-steel uppercase tracking-wide">Coaching</p>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 mt-1 text-left"
      >
        <h1 className="font-display font-bold text-lg uppercase leading-tight">{groupName}</h1>
        <ChevronDown className={`w-4 h-4 text-steel shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-5 right-5 top-full mt-1 bg-surface border border-steel/30 z-20 shadow-lg">
          {groups.length > 3 && (
            <div className="p-2 border-b border-steel/20 flex items-center gap-2">
              <Search className="w-3.5 h-3.5 text-steel shrink-0" />
              <input
                type="text"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                placeholder="Filter groups…"
                autoFocus
                className="flex-1 h-8 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs focus:outline-none focus:border-rust"
              />
            </div>
          )}
          <div className="max-h-64 overflow-y-auto">
            {filteredGroups.map((g) => (
              <div
                key={g.id}
                className={`flex items-center gap-1 group ${
                  g.id === groupId ? "bg-rust/10" : "hover:bg-graphite/50"
                }`}
              >
                <button
                  type="button"
                  onClick={() => switchTo(g.id)}
                  disabled={switching}
                  className={`flex-1 min-w-0 text-left px-3 py-2.5 font-body text-sm disabled:opacity-50 ${
                    g.id === groupId ? "text-rust" : "text-chalk"
                  }`}
                >
                  {editingTagFor === g.id ? (
                    <input
                      type="text"
                      autoFocus
                      value={tagDraft}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setTagDraft(e.target.value)}
                      onBlur={() => persistTag(g.id, tagDraft)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      placeholder="e.g. Bodybuilding"
                      className="w-full h-6 bg-graphite border border-steel/30 text-chalk px-1.5 font-body text-xs focus:outline-none focus:border-rust"
                    />
                  ) : (
                    <>
                      {g.name}
                      {g.focusTag && <span className="text-steel"> · {g.focusTag}</span>}
                    </>
                  )}
                </button>
                {editingTagFor !== g.id && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setTagDraft(g.focusTag ?? "");
                      setEditingTagFor(g.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 shrink-0 px-2 text-steel active:text-rust"
                    aria-label={`Tag ${g.name}`}
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
            {filteredGroups.length === 0 && (
              <p className="px-3 py-2.5 font-body text-xs text-steel">No groups match.</p>
            )}
          </div>
          <div className="border-t border-steel/20 p-2.5">
            {error && (
              <p className="font-body text-[11px] text-rust mb-1.5" role="alert">
                {error}
              </p>
            )}
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateGroup();
                }}
                placeholder="New group name"
                disabled={creating}
                className="flex-1 h-8 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs focus:outline-none focus:border-rust disabled:opacity-60"
              />
              <button
                type="button"
                onClick={handleCreateGroup}
                disabled={creating || !newName.trim()}
                className="h-8 px-2 bg-rust text-graphite flex items-center justify-center disabled:opacity-40"
                aria-label="Create group"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
