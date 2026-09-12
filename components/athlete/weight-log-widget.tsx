"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

export interface WeightLogEntry {
  id: string;
  loggedDate: string;
  weight: number;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function WeightLogWidget({
  athleteId,
  groupId,
  initialLogs,
}: {
  athleteId: string;
  groupId: string;
  initialLogs: WeightLogEntry[];
}) {
  const [logs, setLogs] = useState(initialLogs);
  const [weight, setWeight] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Collapsed to a single line by default — a full-height form every day
  // for every athlete crowds the Day-card for something most people only
  // touch occasionally (see [[athlete_home_calendar_redesign]]). Expands
  // on tap; a coach who wants a real cadence just assigns a "Log body
  // weight" habit instead, no new code needed for that.
  const [expanded, setExpanded] = useState(false);

  const todayLog = logs.find((l) => l.loggedDate === todayIso());

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="w-full border border-steel/20 p-4 flex items-center justify-between text-left"
      >
        <span className="font-body text-sm text-chalk">
          {todayLog ? `Today's weight: ${todayLog.weight} lbs` : "Log today's weight"}
        </span>
        <span className="font-body text-xs text-rust">{todayLog ? "Update" : "Log"}</span>
      </button>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(weight);
    if (!value || value <= 0) return;

    setSubmitting(true);
    setError(null);
    const supabase = createBrowserClient();
    const date = todayIso();

    const { data, error: upsertError } = await supabase
      .from("body_weight_logs")
      .upsert(
        { athlete_id: athleteId, group_id: groupId, logged_date: date, weight: value },
        { onConflict: "athlete_id,logged_date" }
      )
      .select("id, logged_date, weight")
      .single();

    if (upsertError || !data) {
      setError(upsertError?.message ?? "Couldn't save weight.");
      setSubmitting(false);
      return;
    }

    setLogs((prev) => [
      { id: data.id, loggedDate: data.logged_date, weight: data.weight },
      ...prev.filter((l) => l.loggedDate !== date),
    ]);
    setWeight("");
    setSubmitting(false);
    setExpanded(false);
  }

  return (
    <div className="border border-steel/20 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display uppercase text-sm tracking-wide text-steel">Body weight</h2>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="font-body text-xs text-steel"
        >
          Close
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <input
          type="number"
          inputMode="decimal"
          step="0.1"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          placeholder={todayLog ? `Today: ${todayLog.weight} lbs` : "Weight (lbs)"}
          className="flex-1 h-10 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
        />
        <button
          type="submit"
          disabled={submitting || !weight}
          className="h-10 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
        >
          {todayLog ? "Update" : "Log"}
        </button>
      </form>

      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}

      {logs.length > 0 && (
        <div className="mt-3 flex gap-3 overflow-x-auto">
          {logs.slice(0, 7).map((l) => (
            <div key={l.id} className="shrink-0 text-center">
              <p className="font-body text-sm">{l.weight}</p>
              <p className="font-body text-[10px] text-steel">
                {new Date(l.loggedDate + "T00:00:00").toLocaleDateString(undefined, {
                  month: "numeric",
                  day: "numeric",
                })}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
