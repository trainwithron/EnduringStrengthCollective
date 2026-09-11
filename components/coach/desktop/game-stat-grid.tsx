"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

export interface GameStatAthlete {
  profileId: string;
  fullName: string;
  positionId: string | null;
}

export interface GameStatFieldDef {
  id: string;
  name: string;
}

export function GameStatGrid({
  gameId,
  fields,
  athletes,
  initialEntries,
  editable,
}: {
  gameId: string;
  fields: GameStatFieldDef[];
  athletes: GameStatAthlete[];
  initialEntries: { athleteId: string; fieldId: string; value: number }[];
  // Already filtered to just the viewer's own position when they're a
  // position-scoped coach — RLS enforces this for real, this prop just
  // decides whether inputs render as editable at all.
  editable: boolean;
}) {
  const initialMap = new Map(initialEntries.map((e) => [`${e.athleteId}:${e.fieldId}`, e.value]));
  const [values, setValues] = useState(initialMap);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  async function handleChange(athleteId: string, fieldId: string, raw: string) {
    const value = Number(raw) || 0;
    const key = `${athleteId}:${fieldId}`;
    setValues((prev) => new Map(prev).set(key, value));
    setSavingKey(key);
    const supabase = createBrowserClient();
    await supabase
      .from("game_stat_entries")
      .upsert(
        { game_id: gameId, athlete_id: athleteId, field_id: fieldId, value },
        { onConflict: "game_id,athlete_id,field_id" }
      );
    setSavingKey((k) => (k === key ? null : k));
  }

  if (fields.length === 0) {
    return <p className="font-body text-sm text-steel">No stat categories set up yet for this team.</p>;
  }
  if (athletes.length === 0) {
    return <p className="font-body text-sm text-steel">No athletes to show stats for.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="border-collapse w-full">
        <thead>
          <tr className="border-b border-steel/20">
            <th className="text-left font-body text-xs text-steel uppercase tracking-wide font-medium py-2 pr-3">
              Athlete
            </th>
            {fields.map((f) => (
              <th key={f.id} className="text-left font-body text-xs text-steel uppercase tracking-wide font-medium py-2 px-2">
                {f.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {athletes.map((a) => (
            <tr key={a.profileId} className="border-b border-steel/15">
              <td className="py-2 pr-3 font-body text-sm">{a.fullName}</td>
              {fields.map((f) => {
                const key = `${a.profileId}:${f.id}`;
                const value = values.get(key) ?? 0;
                return (
                  <td key={f.id} className="py-2 px-2">
                    {editable ? (
                      <input
                        type="number"
                        value={value}
                        onChange={(e) => handleChange(a.profileId, f.id, e.target.value)}
                        className="w-16 h-8 bg-surface border border-steel/30 text-chalk px-1.5 font-body text-xs text-center"
                      />
                    ) : (
                      <span className="font-body text-sm">{value}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {savingKey && <p className="font-body text-[11px] text-steel mt-1">Saving…</p>}
    </div>
  );
}
