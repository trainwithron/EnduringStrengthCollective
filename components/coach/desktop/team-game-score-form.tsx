"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

export function TeamGameScoreForm({
  gameId,
  initialOurScore,
  initialOpponentScore,
  initialNotes,
}: {
  gameId: string;
  initialOurScore: number | null;
  initialOpponentScore: number | null;
  initialNotes: string | null;
}) {
  const [ourScore, setOurScore] = useState(initialOurScore?.toString() ?? "");
  const [opponentScore, setOpponentScore] = useState(initialOpponentScore?.toString() ?? "");
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [saved, setSaved] = useState(false);

  async function handleBlur() {
    const supabase = createBrowserClient();
    await supabase
      .from("team_games")
      .update({
        our_score: ourScore === "" ? null : Number(ourScore),
        opponent_score: opponentScore === "" ? null : Number(opponentScore),
        notes: notes.trim() || null,
      })
      .eq("id", gameId);
    setSaved(true);
  }

  return (
    <div className="border border-steel/20 p-4 mb-6 max-w-sm">
      <p className="font-display uppercase text-xs tracking-wide text-steel mb-2">Final score</p>
      <div className="flex items-center gap-3 mb-3">
        <label className="flex flex-col gap-1">
          <span className="font-body text-[11px] text-steel uppercase tracking-wide">Us</span>
          <input
            type="number"
            value={ourScore}
            onChange={(e) => setOurScore(e.target.value)}
            onBlur={handleBlur}
            className="w-16 h-9 bg-surface border border-steel/30 text-chalk px-2 font-body text-sm text-center"
          />
        </label>
        <span className="font-display text-lg text-steel mt-4">–</span>
        <label className="flex flex-col gap-1">
          <span className="font-body text-[11px] text-steel uppercase tracking-wide">Them</span>
          <input
            type="number"
            value={opponentScore}
            onChange={(e) => setOpponentScore(e.target.value)}
            onBlur={handleBlur}
            className="w-16 h-9 bg-surface border border-steel/30 text-chalk px-2 font-body text-sm text-center"
          />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="font-body text-[11px] text-steel uppercase tracking-wide">Notes</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={handleBlur}
          rows={2}
          className="bg-surface border border-steel/30 text-chalk px-2 py-1.5 font-body text-sm"
        />
      </label>
      {saved && <p className="font-body text-[11px] text-steel mt-1">Saved.</p>}
    </div>
  );
}
