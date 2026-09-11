"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

export interface WellnessCheckinValues {
  sleepQuality: number;
  soreness: number;
  energy: number;
}

interface ScaleFieldDef {
  key: keyof WellnessCheckinValues;
  label: string;
  lowLabel: string;
  highLabel: string;
}

const FIELDS: ScaleFieldDef[] = [
  { key: "sleepQuality", label: "Sleep quality", lowLabel: "Poor", highLabel: "Great" },
  { key: "soreness", label: "Soreness", lowLabel: "Very sore", highLabel: "Fresh" },
  { key: "energy", label: "Energy", lowLabel: "Low", highLabel: "High" },
];

export function WellnessCheckinWidget({
  athleteId,
  groupId,
  todayDate,
  initialCheckin,
}: {
  athleteId: string;
  groupId: string;
  todayDate: string;
  initialCheckin: WellnessCheckinValues | null;
}) {
  const [saved, setSaved] = useState(initialCheckin);
  const [editing, setEditing] = useState(!initialCheckin);
  const [draft, setDraft] = useState<Partial<WellnessCheckinValues>>(initialCheckin ?? {});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const complete =
    draft.sleepQuality != null && draft.soreness != null && draft.energy != null;

  async function handleSave() {
    if (!complete) return;
    setSubmitting(true);
    setError(null);
    const supabase = createBrowserClient();
    const values = draft as WellnessCheckinValues;

    const { error: upsertError } = await supabase.from("wellness_checkins").upsert(
      {
        athlete_id: athleteId,
        group_id: groupId,
        log_date: todayDate,
        sleep_quality: values.sleepQuality,
        soreness: values.soreness,
        energy: values.energy,
      },
      { onConflict: "athlete_id,group_id,log_date" }
    );

    if (upsertError) {
      setError("Couldn't save — check your connection and try again.");
      setSubmitting(false);
      return;
    }

    setSaved(values);
    setEditing(false);
    setSubmitting(false);
  }

  return (
    <div className="border border-steel/20 p-4">
      <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-3">
        How are you feeling?
      </h2>

      {error && (
        <p className="font-body text-xs text-rust mb-2" role="alert">
          {error}
        </p>
      )}

      {!editing && saved ? (
        <div className="flex items-center justify-between">
          <p className="font-body text-sm text-chalk">
            {FIELDS.map((f) => `${f.label.split(" ")[0]} ${saved[f.key]}`).join(" · ")}
          </p>
          <button
            type="button"
            onClick={() => {
              setDraft(saved);
              setEditing(true);
            }}
            className="font-body text-xs text-rust"
          >
            Edit
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {FIELDS.map((field) => (
            <div key={field.key}>
              <p className="font-body text-sm mb-1.5">{field.label}</p>
              <div className="flex items-center gap-1.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setDraft((prev) => ({ ...prev, [field.key]: n }))}
                    className={`flex-1 h-9 border font-body text-sm ${
                      draft[field.key] === n
                        ? "bg-rust border-rust text-graphite"
                        : "border-steel/30 text-chalk"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="flex justify-between mt-1">
                <span className="font-body text-[10px] text-steel">{field.lowLabel}</span>
                <span className="font-body text-[10px] text-steel">{field.highLabel}</span>
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={handleSave}
            disabled={!complete || submitting}
            className="w-full h-10 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}
