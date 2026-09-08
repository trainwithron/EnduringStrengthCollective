"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { Trash2, Plus } from "lucide-react";

export interface TeamPosition {
  id: string;
  name: string;
  sortOrder: number;
}

export interface TeamPlayer {
  profileId: string;
  fullName: string;
  positionId: string | null;
  depthOrder: number | null;
}

export function TeamDepthChart({
  groupId,
  teamMode,
  initialPositions,
  initialPlayers,
}: {
  groupId: string;
  teamMode: boolean;
  initialPositions: TeamPosition[];
  initialPlayers: TeamPlayer[];
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(teamMode);
  const [enabling, setEnabling] = useState(false);
  const [positions, setPositions] = useState(initialPositions);
  const [players, setPlayers] = useState(initialPlayers);
  const [newPositionName, setNewPositionName] = useState("");
  const [addPositionBusy, setAddPositionBusy] = useState(false);

  async function handleEnable() {
    setEnabling(true);
    const supabase = createBrowserClient();
    const { error } = await supabase.from("groups").update({ team_mode: true }).eq("id", groupId);
    setEnabling(false);
    if (!error) {
      setEnabled(true);
      router.refresh();
    }
  }

  async function handleAddPosition() {
    const name = newPositionName.trim();
    if (!name || addPositionBusy) return;
    setAddPositionBusy(true);
    try {
      const nextOrder =
        positions.length > 0 ? Math.max(...positions.map((p) => p.sortOrder)) + 1 : 0;
      const supabase = createBrowserClient();
      const { data, error } = await supabase
        .from("group_positions")
        .insert({ group_id: groupId, name, sort_order: nextOrder })
        .select("id, name, sort_order")
        .single();
      if (!error && data) {
        setPositions((prev) => [...prev, { id: data.id, name: data.name, sortOrder: data.sort_order }]);
        setNewPositionName("");
      }
    } finally {
      setAddPositionBusy(false);
    }
  }

  async function handleDeletePosition(id: string) {
    if (!window.confirm("Delete this position? Players on it move back to unassigned.")) return;
    const supabase = createBrowserClient();
    const { error } = await supabase.from("group_positions").delete().eq("id", id);
    if (!error) {
      setPositions((prev) => prev.filter((p) => p.id !== id));
      setPlayers((prev) =>
        prev.map((pl) => (pl.positionId === id ? { ...pl, positionId: null, depthOrder: null } : pl))
      );
    }
  }

  async function handleAssign(profileId: string, positionId: string | null) {
    const player = players.find((p) => p.profileId === profileId);
    if (!player) return;
    // Moving to a new (or no) position resets rank — the coach re-ranks
    // from scratch rather than carrying over a number that meant something
    // different at the old position.
    const depthOrder = positionId ? nextDepthOrder(positionId) : null;
    setPlayers((prev) =>
      prev.map((p) => (p.profileId === profileId ? { ...p, positionId, depthOrder } : p))
    );
    const supabase = createBrowserClient();
    await supabase
      .from("group_memberships")
      .update({ position_id: positionId, depth_order: depthOrder })
      .eq("group_id", groupId)
      .eq("profile_id", profileId);
  }

  function nextDepthOrder(positionId: string): number {
    const existing = players.filter((p) => p.positionId === positionId).map((p) => p.depthOrder ?? 0);
    return existing.length > 0 ? Math.max(...existing) + 1 : 1;
  }

  async function handleRankChange(profileId: string, depthOrder: number) {
    setPlayers((prev) =>
      prev.map((p) => (p.profileId === profileId ? { ...p, depthOrder } : p))
    );
    const supabase = createBrowserClient();
    await supabase
      .from("group_memberships")
      .update({ depth_order: depthOrder })
      .eq("group_id", groupId)
      .eq("profile_id", profileId);
  }

  if (!enabled) {
    return (
      <div className="border border-steel/20 p-6 max-w-lg">
        <p className="font-body text-sm text-chalk">
          Team mode adds position groups and a depth chart on top of this group's roster —
          everything else (programming, logging, the feed) works exactly the same.
        </p>
        <button
          type="button"
          onClick={handleEnable}
          disabled={enabling}
          className="h-10 px-5 mt-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
        >
          {enabling ? "Enabling…" : "Enable team mode for this group"}
        </button>
      </div>
    );
  }

  const sortedPositions = positions.slice().sort((a, b) => a.sortOrder - b.sortOrder);
  const unassigned = players
    .filter((p) => !p.positionId)
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  return (
    <div className="space-y-6">
      <div className="border border-steel/20 p-4">
        <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-3">Positions</h2>
        <div className="flex flex-wrap gap-2 mb-3">
          {sortedPositions.map((pos) => (
            <span
              key={pos.id}
              className="h-8 px-3 border border-steel/30 flex items-center gap-2 font-body text-sm"
            >
              {pos.name}
              <button
                type="button"
                onClick={() => handleDeletePosition(pos.id)}
                aria-label={`Delete position ${pos.name}`}
                className="text-steel active:text-rust transition-colors"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </span>
          ))}
          {sortedPositions.length === 0 && (
            <p className="font-body text-sm text-steel">
              No positions yet — add one below (e.g. "Offensive Line," "Point Guard").
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newPositionName}
            onChange={(e) => setNewPositionName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddPosition()}
            placeholder="Position name"
            className="h-9 w-56 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust"
          />
          <button
            type="button"
            onClick={handleAddPosition}
            disabled={addPositionBusy || !newPositionName.trim()}
            className="h-9 px-3 border border-steel/30 text-rust font-body text-xs flex items-center gap-1 disabled:opacity-40"
          >
            <Plus className="w-3.5 h-3.5" />
            Add
          </button>
        </div>
      </div>

      {sortedPositions.map((pos) => {
        const roster = players
          .filter((p) => p.positionId === pos.id)
          .sort((a, b) => (a.depthOrder ?? 999) - (b.depthOrder ?? 999));
        return (
          <div key={pos.id} className="border border-steel/20 p-4">
            <h3 className="font-display uppercase text-sm tracking-wide text-steel mb-3">
              {pos.name}
            </h3>
            {roster.length === 0 ? (
              <p className="font-body text-sm text-steel">No players placed here yet.</p>
            ) : (
              <div className="divide-y divide-steel/15">
                {roster.map((p) => (
                  <PlayerRow
                    key={p.profileId}
                    player={p}
                    positions={sortedPositions}
                    onAssign={handleAssign}
                    onRankChange={handleRankChange}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}

      <div className="border border-steel/20 p-4">
        <h3 className="font-display uppercase text-sm tracking-wide text-steel mb-3">
          Unassigned
        </h3>
        {unassigned.length === 0 ? (
          <p className="font-body text-sm text-steel">Every athlete has a position.</p>
        ) : (
          <div className="divide-y divide-steel/15">
            {unassigned.map((p) => (
              <PlayerRow
                key={p.profileId}
                player={p}
                positions={sortedPositions}
                onAssign={handleAssign}
                onRankChange={handleRankChange}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PlayerRow({
  player,
  positions,
  onAssign,
  onRankChange,
}: {
  player: TeamPlayer;
  positions: TeamPosition[];
  onAssign: (profileId: string, positionId: string | null) => void;
  onRankChange: (profileId: string, depthOrder: number) => void;
}) {
  return (
    <div className="py-2.5 flex items-center justify-between gap-3">
      <span className="font-body text-sm">{player.fullName}</span>
      <div className="flex items-center gap-2 shrink-0">
        {player.positionId && (
          <label className="flex items-center gap-1">
            <span className="font-body text-[11px] text-steel">Rank</span>
            <input
              type="number"
              min={1}
              value={player.depthOrder ?? 1}
              onChange={(e) => onRankChange(player.profileId, Math.max(1, Number(e.target.value) || 1))}
              className="w-14 h-8 bg-graphite border border-steel/30 text-chalk px-1.5 font-body text-xs text-center"
            />
          </label>
        )}
        <select
          value={player.positionId ?? ""}
          onChange={(e) => onAssign(player.profileId, e.target.value || null)}
          className="h-8 bg-graphite border border-steel/30 text-chalk px-1.5 font-body text-xs"
        >
          <option value="">Unassigned</option>
          {positions.map((pos) => (
            <option key={pos.id} value={pos.id}>
              {pos.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
