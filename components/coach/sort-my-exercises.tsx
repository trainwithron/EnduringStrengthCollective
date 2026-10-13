"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { looksUnilateral, progressLine, rankForLevel, type Suggestion } from "@/lib/pattern-sort";
import { PATTERN_NAMES, STARTER_PATTERNS, TIER_KEY, type Tier } from "@/lib/starter-ladders";

interface Row {
  name: string;
  pattern: string; // "" = not chosen yet
  unilateral: boolean;
  tier: Tier | "";
  level: number;
}

const BATCH = 10;

// "Sort my exercises": tag each exercise with its pattern, side and class so templates can pick from them. Rules and an AI suggestion fill in the choices; nothing is saved until the coach confirms.
export function SortMyExercises({
  libraryNames,
  sortedNames,
  patternChoices,
  patternIds,
  ranksByPattern,
}: {
  libraryNames: string[];
  sortedNames: string[];
  patternChoices: string[];
  patternIds: Record<string, string>;
  ranksByPattern: Record<string, number[]>;
}) {
  const router = useRouter();
  const [done, setDone] = useState<Set<string>>(new Set(sortedNames));
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [suggesting, setSuggesting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ids, setIds] = useState<Record<string, string>>(patternIds);
  const [ranks, setRanks] = useState<Record<string, number[]>>(ranksByPattern);

  const total = libraryNames.length;
  const remaining = libraryNames.filter((n) => !done.has(n) && !skipped.has(n));
  const batch = remaining.slice(0, BATCH);
  const rowFor = (name: string): Row => rows[name] ?? { name, pattern: "", unilateral: looksUnilateral(name), tier: "", level: 3 };
  const patch = (name: string, p: Partial<Row>) => setRows((prev) => ({ ...prev, [name]: { ...rowFor(name), ...p } }));
  const choices = [...new Set([...PATTERN_NAMES, ...STARTER_PATTERNS.map((p) => p.name), ...patternChoices])];

  async function suggest() {
    setSuggesting(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/suggest-patterns", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ names: batch }) });
      const data = (await res.json().catch(() => ({}))) as { suggestions?: Suggestion[]; error?: string };
      if (!res.ok || !data.suggestions) {
        setError(data.error && res.status === 429 ? data.error : "Couldn't suggest right now. You can still pick by hand.");
        return;
      }
      setRows((prev) => {
        const next = { ...prev };
        for (const s of data.suggestions!) next[s.name] = { name: s.name, pattern: s.pattern ?? "", unilateral: s.unilateral, tier: s.tier ?? "", level: s.level };
        return next;
      });
    } catch {
      setError("Couldn't suggest right now. You can still pick by hand.");
    } finally {
      setSuggesting(false);
    }
  }

  // Writes the exercise onto its pattern's ladder (creating the pattern if the coach does not have it yet).
  async function save(row: Row): Promise<boolean> {
    const supabase = createBrowserClient();
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return false;
    let patternId = ids[row.pattern];
    if (!patternId) {
      const plane = STARTER_PATTERNS.find((p) => p.name === row.pattern)?.plane ?? null;
      const { data: created, error: createError } = await supabase.from("movement_patterns").insert({ created_by: userId, name: row.pattern, plane }).select("id").single();
      if (createError || !created) return false;
      patternId = created.id as string;
      setIds((prev) => ({ ...prev, [row.pattern]: patternId }));
    }
    const rank = rankForLevel(row.level, ranks[row.pattern] ?? []);
    const { error: writeError } = await supabase
      .from("movement_pattern_exercises")
      .upsert({ movement_pattern_id: patternId, exercise_name: row.name, difficulty_rank: rank, tier: row.tier || null, is_unilateral: row.unilateral }, { onConflict: "movement_pattern_id,exercise_name" });
    if (writeError) return false;
    setRanks((prev) => ({ ...prev, [row.pattern]: [...(prev[row.pattern] ?? []), rank] }));
    return true;
  }

  async function confirm(names: string[]) {
    setBusy(true);
    setError(null);
    const saved: string[] = [];
    for (const name of names) {
      const row = rowFor(name);
      if (!row.pattern) continue;
      if (await save(row)) saved.push(name);
    }
    if (saved.length < names.filter((n) => rowFor(n).pattern).length) setError("Some couldn't be saved. Try those again.");
    setDone((prev) => new Set([...prev, ...saved]));
    setBusy(false);
    router.refresh();
  }

  const select = "h-10 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust";
  const sortedCount = total - libraryNames.filter((n) => !done.has(n)).length;

  return (
    <div>
      <h2 className="font-display font-bold uppercase text-lg leading-none">Sort my exercises</h2>
      <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">Tag each exercise with its pattern, side and class so templates can pick from them. Nothing is saved until you confirm.</p>
      <p className="font-body text-xs text-steel mt-1">{TIER_KEY}</p>
      <p className="font-body text-xs text-steel mt-3" role="status">
        {progressLine(sortedCount, total)}
      </p>

      {batch.length === 0 ? (
        <p className="font-body text-sm text-chalk mt-6">Everything is sorted.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 mt-4">
            <button type="button" onClick={suggest} disabled={suggesting} className="min-h-11 px-4 border border-rust text-rust font-body text-sm font-medium disabled:opacity-40">
              {suggesting ? "Thinking…" : `Suggest for the next ${batch.length}`}
            </button>
            <button type="button" onClick={() => confirm(batch)} disabled={busy || batch.every((n) => !rowFor(n).pattern)} className="min-h-11 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
              {busy ? "Saving…" : "Confirm all shown"}
            </button>
          </div>
          {error && (
            <p className="font-body text-xs text-rust mt-2" role="alert">
              {error}
            </p>
          )}
          <ul className="mt-4 divide-y divide-steel/15 border-y border-steel/15">
            {batch.map((name) => {
              const r = rowFor(name);
              return (
                <li key={name} className="py-3">
                  <p className="font-body font-medium text-[15px]">{name}</p>
                  <div className="flex flex-wrap items-end gap-2 mt-2">
                    <label className="font-body text-xs text-steel">
                      Pattern
                      <select value={r.pattern} onChange={(e) => patch(name, { pattern: e.target.value })} className={`${select} block mt-1`}>
                        <option value="">Choose a pattern</option>
                        {choices.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="font-body text-xs text-steel">
                      Side
                      <select value={r.unilateral ? "unilateral" : "bilateral"} onChange={(e) => patch(name, { unilateral: e.target.value === "unilateral" })} className={`${select} block mt-1`}>
                        <option value="bilateral">Bilateral</option>
                        <option value="unilateral">Unilateral</option>
                      </select>
                    </label>
                    <label className="font-body text-xs text-steel">
                      Class
                      <select value={r.tier} onChange={(e) => patch(name, { tier: e.target.value as Tier | "" })} className={`${select} block mt-1`}>
                        <option value="">No class</option>
                        <option value="A">Class A</option>
                        <option value="B">Class B</option>
                        <option value="C">Class C</option>
                      </select>
                    </label>
                    <label className="font-body text-xs text-steel">
                      Level 1 (easy) to 5 (hard)
                      <select value={r.level} onChange={(e) => patch(name, { level: Number(e.target.value) })} className={`${select} block mt-1`}>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="button" onClick={() => confirm([name])} disabled={busy || !r.pattern} className="min-h-10 px-3 border border-rust text-rust font-body text-sm disabled:opacity-40">
                      Confirm
                    </button>
                    <button type="button" onClick={() => setSkipped((prev) => new Set([...prev, name]))} className="min-h-10 px-3 font-body text-sm text-steel">
                      Skip
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
