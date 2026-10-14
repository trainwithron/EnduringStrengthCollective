"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { CLAUSES, clauseKey } from "@/lib/clauses";

interface Clause {
  key: string;
  label: string;
}

// "Clauses (what we program around)": the named things the AI builds around for this client ("Back limits", "No rotation"). The coach adds and removes them; what the AI has learned from the coach's
// corrections is attached to clauses, so a rule like "no barbell squats" reaches only clients who have the clause it is for. Only the name is kept here, never medical text. Private to the coach.
export function ClientClauses({ athleteId, groupId, coachId }: { athleteId: string; groupId: string; coachId: string }) {
  const [clauses, setClauses] = useState<Clause[] | null>(null);
  const [custom, setCustom] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void createBrowserClient()
      .from("client_clauses")
      .select("key, label")
      .eq("coach_id", coachId)
      .eq("athlete_id", athleteId)
      .order("created_at", { ascending: true })
      .then(({ data, error: e }) => setClauses(e ? [] : ((data ?? []) as Clause[])));
  }, [athleteId, coachId]);

  async function add(label: string, key: string) {
    setError(null);
    if (!key || (clauses ?? []).some((c) => c.key === key)) return;
    const { error: e } = await createBrowserClient().from("client_clauses").insert({ coach_id: coachId, athlete_id: athleteId, group_id: groupId, key, label: label.trim().slice(0, 60) });
    if (e) {
      setError("That didn't save. Nothing was changed.");
      return;
    }
    setClauses((prev) => [...(prev ?? []), { key, label: label.trim() }]);
    setCustom("");
  }

  async function remove(key: string) {
    setError(null);
    const { error: e } = await createBrowserClient().from("client_clauses").delete().eq("coach_id", coachId).eq("athlete_id", athleteId).eq("key", key);
    if (e) {
      setError("That didn't save. Nothing was changed.");
      return;
    }
    setClauses((prev) => (prev ?? []).filter((c) => c.key !== key));
  }

  const have = new Set((clauses ?? []).map((c) => c.key));
  return (
    <div>
      <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-1">Clauses (what we program around)</h2>
      <p className="font-body text-xs text-steel mb-2">What the AI builds around for this client. Rules it learns from you attach to these. Only you see them.</p>
      {clauses === null ? null : clauses.length === 0 ? (
        <p className="font-body text-sm text-steel mb-2">None yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-2 mb-2" aria-label="This client's clauses">
          {clauses.map((c) => (
            <li key={c.key} className="inline-flex items-center gap-1 border border-steel/30 pl-3 font-body text-sm text-chalk">
              {c.label}
              <button type="button" onClick={() => void remove(c.key)} aria-label={`Remove ${c.label}`} className="w-11 h-11 flex items-center justify-center text-steel active:text-rust">
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        {CLAUSES.filter((c) => !have.has(c.key)).map((c) => (
          <button key={c.key} type="button" onClick={() => void add(c.label, c.key)} className="min-h-11 px-3 border border-steel/30 font-body text-xs text-steel">
            + {c.label}
          </button>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          type="text"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          maxLength={60}
          placeholder="Name your own, for example Ankle stability"
          aria-label="Name a clause"
          className="flex-1 min-w-0 h-11 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust"
        />
        <button type="button" disabled={clauseKey(custom) === ""} onClick={() => void add(custom, clauseKey(custom))} className="min-h-11 px-4 border border-rust text-rust font-body text-sm disabled:opacity-40">
          Add
        </button>
      </div>
      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
