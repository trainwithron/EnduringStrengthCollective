"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { RailWidgetHeader, RailWidgetDeeperLink, RailWidgetLoading } from "./rail-widget-shell";

// Hover rail widgets (hover_expand_rail_widgets_idea.md) — Team icon.
// Same-day completion-rate glance ("8 of 12 logged today") — the real
// proposal Ron confirmed once the original ACWR/burnout idea turned out
// to need math this app doesn't have yet
// (synthetic_longitudinal_spotter_simulation_idea.md's research
// correction). Roster count from group_memberships, logged-today count
// from workout_logs — the same two tables Team Performance's own roster
// list already reads, not a fresh parallel computation.
export function TeamRailWidget({ groupId }: { groupId: string }) {
  const [counts, setCounts] = useState<{ logged: number; total: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createBrowserClient();
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

      const [{ data: rosterRows }, { data: logRows }] = await Promise.all([
        supabase.from("group_memberships").select("profile_id").eq("group_id", groupId).eq("role", "athlete"),
        supabase.from("workout_logs").select("athlete_id").eq("group_id", groupId).gte("created_at", startOfDay),
      ]);

      if (!cancelled) {
        setCounts({
          total: (rosterRows ?? []).length,
          logged: new Set((logRows ?? []).map((l) => l.athlete_id)).size,
        });
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  return (
    <div>
      <RailWidgetHeader title="Today's logging" />
      {counts === null ? (
        <RailWidgetLoading />
      ) : (
        <div className="flex items-baseline gap-1.5">
          <span className="font-display font-bold text-2xl leading-none text-chalk">{counts.logged}</span>
          <span className="font-body text-sm text-steel">of {counts.total} logged today</span>
        </div>
      )}
      <RailWidgetDeeperLink href={`/groups/${groupId}/team-performance`} label="Open Team Performance" />
    </div>
  );
}
