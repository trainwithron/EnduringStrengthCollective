"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { LEVELS } from "@/lib/use-template";
import type { Level } from "@/lib/slot-templates";

// One client's training level with this coach (Beginner / Intermediate / Advanced). It pre-fills the level when a template is used for them; it changes nothing else.
export function TrainingLevelControl({ athleteId, groupId, initialLevel }: { athleteId: string; groupId: string; initialLevel: Level | null }) {
  const [level, setLevel] = useState<Level | "">(initialLevel ?? "");
  const [error, setError] = useState<string | null>(null);

  async function change(next: Level | "") {
    const before = level;
    setLevel(next);
    setError(null);
    // Ask for the row back: row security can change zero rows without an error, and this should only say it saved when a row really changed.
    const { data, error: saveError } = await createBrowserClient()
      .from("group_memberships")
      .update({ training_level: next === "" ? null : next })
      .eq("group_id", groupId)
      .eq("profile_id", athleteId)
      .select("training_level");
    if (saveError || !data || data.length === 0) {
      setLevel(before);
      setError("That didn't save. It is back to what it was.");
    }
  }

  return (
    <div className="mb-3" data-testid="training-level-control">
      <label className="flex items-center gap-3 font-body text-sm text-chalk">
        Training level
        <select value={level} onChange={(e) => void change(e.target.value as Level | "")} className="h-10 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust">
          <option value="">Not set</option>
          {LEVELS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
      </label>
      <p className="font-body text-xs text-steel mt-1">Used to pre-fill the level when you use a template for them.</p>
      {error && (
        <p className="font-body text-xs text-rust mt-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
