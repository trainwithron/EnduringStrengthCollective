"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

type Destination = "existing" | "new";

interface OrgGroupOption {
  id: string;
  name: string;
}

// Moves a client's membership AND all their group-scoped data (credits,
// logged history, notes, habits, macros, bookings, personal programs) to
// a different group in one atomic step, via the move_client_to_group RPC
// — reassigning just the group_memberships row would silently orphan the
// rest, since a client's data is scattered across ~15 tables keyed by
// (athlete_id, group_id). Mirrors AddClientButton's destination picker
// (existing group vs. create a new one) for a consistent mental model.
export function ChangeClientGroupControl({
  athleteId,
  athleteName,
  currentGroupId,
  currentGroupName,
}: {
  athleteId: string;
  athleteName: string;
  currentGroupId: string;
  currentGroupName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [destination, setDestination] = useState<Destination>("existing");
  const [orgGroups, setOrgGroups] = useState<OrgGroupOption[] | null>(null);
  const [loadingOrgGroups, setLoadingOrgGroups] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [newGroupName, setNewGroupName] = useState(`${athleteName}`);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadOrgGroups() {
    if (orgGroups || loadingOrgGroups) return;
    setLoadingOrgGroups(true);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoadingOrgGroups(false);
      return;
    }

    const [{ data: membership }, { data: coachedRows }] = await Promise.all([
      supabase.from("organization_memberships").select("organization_id, role").eq("profile_id", user.id).maybeSingle(),
      supabase.from("group_memberships").select("groups ( id, name )").eq("profile_id", user.id).eq("role", "coach"),
    ]);

    const byId = new Map<string, OrgGroupOption>();
    for (const row of coachedRows ?? []) {
      const g = (row as any).groups;
      if (g && g.id !== currentGroupId) byId.set(g.id, { id: g.id, name: g.name });
    }
    if (membership && (membership.role === "owner" || membership.role === "admin")) {
      const { data: allGroups } = await supabase
        .from("groups")
        .select("id, name")
        .eq("organization_id", membership.organization_id)
        .neq("id", currentGroupId)
        .order("name");
      for (const g of allGroups ?? []) byId.set(g.id, { id: g.id, name: g.name });
    }

    const sorted = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
    setOrgGroups(sorted);
    setSelectedGroupId(sorted[0]?.id ?? "");
    setLoadingOrgGroups(false);
  }

  async function handleMove() {
    if (moving) return;
    setError(null);

    if (destination === "existing" && !selectedGroupId) {
      setError("Pick a group.");
      return;
    }
    const trimmedNewName = newGroupName.trim();
    if (destination === "new" && !trimmedNewName) {
      setError("Enter a group name.");
      return;
    }

    const confirmMessage =
      destination === "existing"
        ? `Move ${athleteName} to "${orgGroups?.find((g) => g.id === selectedGroupId)?.name ?? "this group"}"? Their credits, history, and programs move with them.`
        : `Create a new 1-on-1 group "${trimmedNewName}" and move ${athleteName} into it?`;
    if (!window.confirm(confirmMessage)) return;

    setMoving(true);
    const supabase = createBrowserClient();
    let targetGroupId: string;

    if (destination === "existing") {
      targetGroupId = selectedGroupId;
    } else {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("Couldn't create the group — try again.");
        setMoving(false);
        return;
      }
      const { data: membership } = await supabase
        .from("organization_memberships")
        .select("organization_id")
        .eq("profile_id", user.id)
        .maybeSingle();
      if (!membership) {
        setError("Couldn't find your organization — try again.");
        setMoving(false);
        return;
      }
      const newGroupId = crypto.randomUUID();
      const { error: groupError } = await supabase.from("groups").insert({
        id: newGroupId,
        name: trimmedNewName,
        created_by: user.id,
        organization_id: membership.organization_id,
        group_kind: "one_on_one",
      });
      if (groupError) {
        setError("Couldn't create the group — try again.");
        setMoving(false);
        return;
      }
      await supabase.from("group_memberships").insert({ group_id: newGroupId, profile_id: user.id, role: "coach" });
      targetGroupId = newGroupId;
    }

    const { error: rpcError } = await supabase.rpc("move_client_to_group", {
      p_athlete_id: athleteId,
      p_from_group_id: currentGroupId,
      p_to_group_id: targetGroupId,
    });

    if (rpcError) {
      setError(rpcError.message || "Couldn't move this client.");
      setMoving(false);
      return;
    }

    router.push(`/groups/${targetGroupId}/athletes/${athleteId}`);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="font-body text-xs text-steel underline decoration-dotted active:text-rust"
      >
        Move to a different group
      </button>
    );
  }

  return (
    <div className="border border-steel/30 p-3 max-w-sm bg-surface">
      <p className="font-body text-xs text-steel mb-2">
        Currently in <span className="text-chalk">{currentGroupName}</span>. Moving carries their credits, logged
        history, notes, and personal programs to the new group.
      </p>
      <div className="flex items-center gap-1 mb-2">
        {(["existing", "new"] as Destination[]).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => {
              setDestination(d);
              setError(null);
              if (d === "existing") loadOrgGroups();
            }}
            className={`h-8 px-3 font-body text-xs border ${
              destination === d ? "bg-rust text-graphite border-rust" : "border-steel/30 text-steel"
            }`}
          >
            {d === "existing" ? "Existing group" : "New 1-on-1 group"}
          </button>
        ))}
      </div>
      {destination === "existing" ? (
        <select
          value={selectedGroupId}
          onChange={(e) => setSelectedGroupId(e.target.value)}
          disabled={loadingOrgGroups}
          className="w-full h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs focus:outline-none focus:border-rust disabled:opacity-60"
        >
          {loadingOrgGroups && <option>Loading…</option>}
          {!loadingOrgGroups && (orgGroups ?? []).length === 0 && <option value="">No other groups yet</option>}
          {(orgGroups ?? []).map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
          placeholder="Group name"
          className="w-full h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs focus:outline-none focus:border-rust"
        />
      )}
      {error && <p className="font-body text-xs text-rust mt-2">{error}</p>}
      <div className="flex items-center gap-3 mt-3">
        <button
          type="button"
          onClick={handleMove}
          disabled={moving}
          className="h-9 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
        >
          {moving ? "Moving…" : "Move client"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={moving}
          className="font-body text-xs text-steel disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
