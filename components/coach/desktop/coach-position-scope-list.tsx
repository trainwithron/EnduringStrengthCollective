"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { TeamPosition } from "./team-depth-chart";

export interface CoachStaffRow {
  profileId: string;
  fullName: string;
  coachPositionId: string | null;
}

// The one control that actually turns tiered permissions on: scoping a
// coach to a single position restricts them to that position's athletes
// for game-stat entry only (enforced by RLS on game_stat_entries) —
// everything else they could already do (roster, programs, etc.) is
// completely unaffected. Leaving a coach at "All positions" (the
// default for every coach today) changes nothing about them.
export function CoachPositionScopeList({
  groupId,
  positions,
  initialCoaches,
}: {
  groupId: string;
  positions: TeamPosition[];
  initialCoaches: CoachStaffRow[];
}) {
  const [coaches, setCoaches] = useState(initialCoaches);

  async function handleChange(profileId: string, positionId: string | null) {
    setCoaches((prev) => prev.map((c) => (c.profileId === profileId ? { ...c, coachPositionId: positionId } : c)));
    const supabase = createBrowserClient();
    await supabase
      .from("group_memberships")
      .update({ coach_position_id: positionId })
      .eq("group_id", groupId)
      .eq("profile_id", profileId);
  }

  if (positions.length === 0) return null;

  return (
    <div className="border border-steel/20 p-4 mb-6">
      <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-1">Coaching staff scope</h2>
      <p className="font-body text-xs text-steel mb-3">
        Scoping a coach to one position limits them to entering game stats for that position&apos;s
        players only. Everything else — programs, roster, the feed — is unaffected either way.
      </p>
      <div className="divide-y divide-steel/15">
        {coaches.map((c) => (
          <div key={c.profileId} className="py-2.5 flex items-center justify-between gap-3">
            <span className="font-body text-sm">{c.fullName}</span>
            <select
              value={c.coachPositionId ?? ""}
              onChange={(e) => handleChange(c.profileId, e.target.value || null)}
              className="h-8 bg-graphite border border-steel/30 text-chalk px-1.5 font-body text-xs"
            >
              <option value="">All positions</option>
              {positions.map((pos) => (
                <option key={pos.id} value={pos.id}>
                  {pos.name} only
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}
