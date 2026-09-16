"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

interface OrgGroupOption {
  id: string;
  name: string;
}

// social_only_group_membership_idea.md — the real, still-missing piece
// once the schema/RLS/booking side already shipped (migration 0125): a
// coach-facing way to actually grant a client social-only access to a
// SECOND group (Feed/chat/leaderboard) without moving them off their
// real 1-on-1/training group. Deliberately additive, not a move —
// ChangeClientGroupControl already covers "move this client
// entirely"; this is "also let them into this other group, socially
// only." Keep minimal: one group picker, one insert, no separate
// management surface for social-only memberships yet.
export function AddSocialOnlyMembershipControl({
  athleteId,
  athleteName,
  currentGroupId,
}: {
  athleteId: string;
  athleteName: string;
  currentGroupId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [orgGroups, setOrgGroups] = useState<OrgGroupOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Same org-scoped "every group this coach actually coaches, minus the
  // current one" lookup as ChangeClientGroupControl — a client can only
  // be added to a group their own coach genuinely runs.
  async function loadOrgGroups() {
    if (orgGroups || loading) return;
    setLoading(true);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    const { data: currentGroup } = await supabase
      .from("groups")
      .select("organization_id")
      .eq("id", currentGroupId)
      .maybeSingle();
    const currentOrgId = currentGroup?.organization_id ?? null;

    const [{ data: membership }, { data: coachedRows }, { data: existingMemberships }] = await Promise.all([
      currentOrgId
        ? supabase
            .from("organization_memberships")
            .select("organization_id, role")
            .eq("organization_id", currentOrgId)
            .eq("profile_id", user.id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from("group_memberships").select("groups ( id, name )").eq("profile_id", user.id).eq("role", "coach"),
      // Never offer a group this client already belongs to — the unique
      // (group_id, profile_id) constraint would just reject it anyway,
      // but filtering here gives a real reason instead of a raw DB error.
      supabase.from("group_memberships").select("group_id").eq("profile_id", athleteId),
    ]);

    const alreadyIn = new Set((existingMemberships ?? []).map((m) => m.group_id));
    const byId = new Map<string, OrgGroupOption>();
    for (const row of coachedRows ?? []) {
      const g = (row as any).groups;
      if (g && !alreadyIn.has(g.id)) byId.set(g.id, { id: g.id, name: g.name });
    }
    if (membership && (membership.role === "owner" || membership.role === "admin")) {
      const { data: allGroups } = await supabase
        .from("groups")
        .select("id, name")
        .eq("organization_id", membership.organization_id)
        .order("name");
      for (const g of allGroups ?? []) {
        if (!alreadyIn.has(g.id)) byId.set(g.id, { id: g.id, name: g.name });
      }
    }

    const sorted = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
    setOrgGroups(sorted);
    setSelectedGroupId(sorted[0]?.id ?? "");
    setLoading(false);
  }

  async function handleAdd() {
    if (adding || !selectedGroupId) return;
    setAdding(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: insertError } = await supabase.from("group_memberships").insert({
      group_id: selectedGroupId,
      profile_id: athleteId,
      role: "athlete",
      membership_type: "social_only",
    });
    if (insertError) {
      setError(insertError.message || "Couldn't add this membership — try again.");
      setAdding(false);
      return;
    }
    setAdding(false);
    setDone(true);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          loadOrgGroups();
        }}
        className="font-body text-xs text-steel underline decoration-dotted active:text-rust"
      >
        Add to a group for social access only
      </button>
    );
  }

  if (done) {
    return (
      <p className="font-body text-xs text-positive">
        Added — {athleteName} can now see that group&apos;s Feed/leaderboard. Their real
        programming and billing stay right here.
      </p>
    );
  }

  return (
    <div className="border border-steel/30 p-3 max-w-sm bg-surface">
      <p className="font-body text-xs text-steel mb-2">
        Gives {athleteName} access to that group&apos;s Feed, chat, and leaderboard only —
        programming, billing, and credits stay anchored here, unaffected.
      </p>
      <select
        value={selectedGroupId}
        onChange={(e) => setSelectedGroupId(e.target.value)}
        disabled={loading}
        className="w-full h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs focus:outline-none focus:border-rust disabled:opacity-60"
      >
        {loading && <option>Loading…</option>}
        {!loading && (orgGroups ?? []).length === 0 && <option value="">No other groups available</option>}
        {(orgGroups ?? []).map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
      {error && <p className="font-body text-xs text-rust mt-2">{error}</p>}
      <div className="flex items-center gap-3 mt-3">
        <button
          type="button"
          onClick={handleAdd}
          disabled={adding || !selectedGroupId}
          className="h-9 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
        >
          {adding ? "Adding…" : "Add"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={adding}
          className="font-body text-xs text-steel disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
