"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { buildRungInserts, planStarterAdd, starterResultLine, type ExistingPattern } from "@/lib/starter-ladders";

// "Add the starter ladders": a ladder for every movement pattern, easiest at the top, in the coach's own library. Only what is missing is added; nothing they have is changed.
export function AddStarterLaddersButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    setLine(null);
    try {
      const supabase = createBrowserClient();
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("not signed in");
      const { data: rows, error: readError } = await supabase
        .from("movement_patterns")
        .select("id, name, movement_pattern_exercises ( exercise_name, difficulty_rank )")
        .eq("created_by", userId);
      if (readError) throw readError;
      const existing: (ExistingPattern & { maxRank: number })[] = ((rows ?? []) as any[]).map((p) => ({
        id: p.id as string,
        name: p.name as string,
        exerciseNames: ((p.movement_pattern_exercises ?? []) as any[]).map((e) => e.exercise_name as string),
        maxRank: Math.max(-1, ...((p.movement_pattern_exercises ?? []) as any[]).map((e) => Number(e.difficulty_rank) || 0)),
      }));
      const plan = planStarterAdd(existing);
      const idByName = new Map<string, string>(existing.map((p) => [p.name, p.id as string]));
      if (plan.newPatterns.length > 0) {
        const { data: created, error: createError } = await supabase
          .from("movement_patterns")
          .insert(plan.newPatterns.map((p) => ({ created_by: userId, name: p.name, plane: p.plane })))
          .select("id, name");
        if (createError) throw createError;
        for (const c of (created ?? []) as { id: string; name: string }[]) idByName.set(c.name, c.id);
      }
      const maxRank = new Map<string, number>(existing.filter((p) => p.exerciseNames.length > 0).map((p) => [p.name, p.maxRank]));
      const inserts = buildRungInserts(plan, idByName, maxRank);
      if (inserts.length > 0) {
        const { error: rungError } = await supabase.from("movement_pattern_exercises").insert(inserts);
        if (rungError) throw rungError;
      }
      setLine(starterResultLine(plan));
      router.refresh();
    } catch {
      setError("Couldn't add them. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4">
      <button type="button" onClick={add} disabled={busy} className="min-h-11 px-4 border border-rust text-rust font-body text-sm font-medium disabled:opacity-40">
        {busy ? "Adding…" : "Add the starter ladders"}
      </button>
      <p className="font-body text-xs text-steel mt-1">Adds a ladder for each movement pattern, easiest at the top. Yours stay as they are.</p>
      {line && (
        <p className="font-body text-sm text-chalk mt-1" role="status">
          {line}
        </p>
      )}
      {error && (
        <p className="font-body text-xs text-rust mt-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
