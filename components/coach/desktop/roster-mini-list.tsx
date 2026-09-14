"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";
import { daysSinceOf, clientActivityStatus } from "@/lib/client-activity-status";
import { initialsOf } from "@/lib/initials";

interface MiniRosterMember {
  athleteId: string;
  fullName: string;
  lastWorkoutAt: string | null;
}

// The list panel's default view (coach_desktop_shell_identity_
// redesign.md) — a compact roster, not the full Clients page's card
// grid (that already has pagination/integrity/nutrition data it doesn't
// need at 220-560px wide). Same "needs attention first" sort comparator
// as client-card-grid.tsx. Previously reimplemented locally rather than
// importing (client-card-grid.tsx was a heavier component to pull in) —
// now imports the same lib/client-activity-status.ts helper
// client-card-grid.tsx and home-client-card.tsx use, since that's a
// lean pure-logic module, not the heavier component; a codebase audit
// caught this local copy had quietly drifted (day-1 showed "moss" here
// but "steel" everywhere else) once it stopped being updated alongside
// the other two.
export function RosterMiniList({ groupId }: { groupId: string }) {
  const [members, setMembers] = useState<MiniRosterMember[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createBrowserClient();
      const { data: memberRows } = await supabase
        .from("group_memberships")
        .select("profile_id, profiles ( full_name )")
        .eq("group_id", groupId)
        .eq("role", "athlete");

      const athleteIds = (memberRows ?? []).map((m: any) => m.profile_id);
      const { data: logRows } =
        athleteIds.length > 0
          ? await supabase
              .from("workout_logs")
              .select("athlete_id, created_at")
              .in("athlete_id", athleteIds)
              .eq("group_id", groupId)
              .order("created_at", { ascending: false })
          : { data: [] };

      const lastByAthlete = new Map<string, string>();
      for (const row of logRows ?? []) {
        if (!lastByAthlete.has(row.athlete_id)) lastByAthlete.set(row.athlete_id, row.created_at);
      }

      const list: MiniRosterMember[] = (memberRows ?? []).map((m: any) => ({
        athleteId: m.profile_id,
        fullName: m.profiles?.full_name ?? "Client",
        lastWorkoutAt: lastByAthlete.get(m.profile_id) ?? null,
      }));
      list.sort((a, b) => daysSinceOf(b.lastWorkoutAt) - daysSinceOf(a.lastWorkoutAt));

      if (!cancelled) setMembers(list);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  if (members === null) {
    return <p className="font-body text-xs text-steel px-1">Loading…</p>;
  }
  if (members.length === 0) {
    return <p className="font-body text-xs text-steel px-1">No clients yet.</p>;
  }

  return (
    <div className="space-y-0.5">
      {members.map((m) => (
        <Link
          key={m.athleteId}
          href={`/groups/${groupId}/athletes/${m.athleteId}`}
          className="flex items-center gap-2.5 px-1.5 py-2 hover:bg-surface/40 transition-colors"
        >
          <span className="relative shrink-0 w-7 h-7 rounded-full bg-surface border border-steel/30 flex items-center justify-center font-body text-[10px] text-steel">
            {initialsOf(m.fullName)}
            <span
              className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-graphite ${
                clientActivityStatus(m.lastWorkoutAt).dotClass
              }`}
            />
          </span>
          <span className="font-body text-sm text-chalk truncate">{m.fullName}</span>
        </Link>
      ))}
    </div>
  );
}
