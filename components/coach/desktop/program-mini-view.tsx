"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";

interface MiniWorkout {
  id: string;
  title: string;
  weekNumber: number;
  dayIndex: number;
}

// calendar_workout_scheduling_and_adjustable_workspace_idea.md item 4 —
// the "condensed Program Builder" view Ron asked for: this group's
// active shared program's week/day list, glanceable while working
// somewhere else, not the full drag/reorder/exercise-editing builder
// (that stays the dedicated page's job — "Open full builder" goes
// there for any real edit).
export function ProgramMiniView({ groupId }: { groupId: string }) {
  const [programName, setProgramName] = useState<string | null>(null);
  const [programId, setProgramId] = useState<string | null>(null);
  const [workouts, setWorkouts] = useState<MiniWorkout[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createBrowserClient();
      const { data: program } = await supabase
        .from("programs")
        .select("id, name")
        .eq("group_id", groupId)
        .eq("is_active", true)
        .is("athlete_id", null)
        .maybeSingle();

      if (!program) {
        if (!cancelled) {
          setProgramId(null);
          setProgramName(null);
          setWorkouts([]);
        }
        return;
      }

      const { data: workoutRows } = await supabase
        .from("workouts")
        .select("id, title, week_number, day_index")
        .eq("program_id", program.id)
        .order("week_number", { ascending: true })
        .order("day_index", { ascending: true });

      if (!cancelled) {
        setProgramId(program.id);
        setProgramName(program.name);
        setWorkouts(
          (workoutRows ?? []).map((w) => ({ id: w.id, title: w.title, weekNumber: w.week_number, dayIndex: w.day_index }))
        );
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  if (workouts === null) {
    return <p className="font-body text-xs text-steel px-1">Loading…</p>;
  }
  if (!programId) {
    return (
      <div>
        <p className="font-body text-xs text-steel px-1 mb-2">No active shared program yet.</p>
        <Link href={`/groups/${groupId}/programs/new`} className="font-body text-xs text-rust px-1">
          + New program &rarr;
        </Link>
      </div>
    );
  }

  // Grouped by week so it reads like the real builder's own shape, just
  // titles instead of full exercise/set editing.
  const byWeek = new Map<number, MiniWorkout[]>();
  for (const w of workouts) {
    if (!byWeek.has(w.weekNumber)) byWeek.set(w.weekNumber, []);
    byWeek.get(w.weekNumber)!.push(w);
  }

  return (
    <div>
      <Link
        href={`/groups/${groupId}/programs/${programId}`}
        className="block font-body text-xs text-rust px-1 mb-2 truncate"
      >
        {programName} — open full builder &rarr;
      </Link>
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {Array.from(byWeek.entries()).map(([week, days]) => (
          <div key={week}>
            <p className="font-body text-[10px] text-steel uppercase tracking-wide px-1.5 mb-0.5">
              Week {week}
            </p>
            {days.map((d) => (
              <Link
                key={d.id}
                href={`/groups/${groupId}/programs/${programId}`}
                className="block px-1.5 py-1.5 font-body text-sm text-chalk truncate hover:bg-surface/40 transition-colors"
              >
                Day {d.dayIndex + 1}: {d.title}
              </Link>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
