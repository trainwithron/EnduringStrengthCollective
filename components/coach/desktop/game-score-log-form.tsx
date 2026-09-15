"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

export interface GameRosterAthlete {
  profileId: string;
  fullName: string;
}

export function GameScoreLogForm({
  groupId,
  exerciseName,
  roster,
  coachId,
}: {
  groupId: string;
  exerciseName: string;
  roster: GameRosterAthlete[];
  coachId: string;
}) {
  const router = useRouter();
  const [athleteId, setAthleteId] = useState(roster[0]?.profileId ?? "");
  const [points, setPoints] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    const value = Number(points);
    if (!athleteId || !points.trim() || !(value >= 0)) return;
    setSubmitting(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: insertError } = await supabase.from("game_score_entries").insert({
      group_id: groupId,
      exercise_name: exerciseName,
      athlete_id: athleteId,
      points: value,
      logged_by: coachId,
    });
    setSubmitting(false);
    if (insertError) {
      setError("Couldn't log that score — try again.");
      return;
    }
    setPoints("");
    router.refresh();
  }

  if (roster.length === 0) {
    return <p className="font-body text-sm text-steel">No athletes in this group yet.</p>;
  }

  return (
    <div className="flex items-end gap-3 mb-6">
      <div className="flex flex-col gap-1">
        <label className="font-body text-[11px] text-steel uppercase tracking-wide">Athlete</label>
        <select
          value={athleteId}
          onChange={(e) => setAthleteId(e.target.value)}
          className="h-10 bg-surface border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
        >
          {roster.map((a) => (
            <option key={a.profileId} value={a.profileId}>
              {a.fullName}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="font-body text-[11px] text-steel uppercase tracking-wide">Points</label>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          value={points}
          onChange={(e) => setPoints(e.target.value)}
          placeholder="0"
          className="h-10 w-28 bg-surface border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
        />
      </div>
      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitting || !points.trim()}
        className="h-10 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
      >
        {submitting ? "Logging…" : "Log score"}
      </button>
      {error && <span className="font-body text-xs text-rust">{error}</span>}
    </div>
  );
}
