"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { notifyPush } from "@/lib/push-notify";
import { isHighPriorityClient } from "@/lib/notification-priority";
import { isLowReadiness, sorenessShown, sorenessStored } from "@/lib/wellness";

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
  // The scale reads the other way round from how it is stored (soreness: shown 1 = Fresh ... 5 = Very sore; stored 5 = fresh).
  flipped?: boolean;
}

const FIELDS: ScaleFieldDef[] = [
  { key: "sleepQuality", label: "Sleep quality", lowLabel: "Poor", highLabel: "Great" },
  { key: "soreness", label: "Soreness", lowLabel: "Fresh", highLabel: "Very sore", flipped: true },
  { key: "energy", label: "Energy", lowLabel: "Low", highLabel: "High" },
];

export function WellnessCheckinWidget({
  athleteId,
  groupId,
  todayDate,
  initialCheckin,
  onSaved,
  lifeImpactPrompt = null,
}: {
  athleteId: string;
  groupId: string;
  todayDate: string;
  initialCheckin: WellnessCheckinValues | null;
  onSaved?: (values: WellnessCheckinValues) => void;
  // AI Assistant Slice 5 (life_impact_reflection_prompt_idea.md) — set
  // only when the occasional-cadence check (lib/life-impact-prompt.ts)
  // says today is a day to ask. Deliberately optional, never blocks
  // completing the numeric check-in — a client who ignores it still
  // saves normally.
  lifeImpactPrompt?: string | null;
}) {
  const [saved, setSaved] = useState(initialCheckin);
  const [editing, setEditing] = useState(!initialCheckin);
  const [draft, setDraft] = useState<Partial<WellnessCheckinValues>>(initialCheckin ?? {});
  const [error, setError] = useState<string | null>(null);
  const [lifeImpactNote, setLifeImpactNote] = useState("");
  const [lifeImpactDismissed, setLifeImpactDismissed] = useState(false);

  const complete =
    draft.sleepQuality != null && draft.soreness != null && draft.energy != null;

  function handleSave() {
    if (!complete) return;
    setError(null);
    const supabase = createBrowserClient();
    const values = draft as WellnessCheckinValues;
    const previousSaved = saved;

    // Show the saved summary immediately — the upsert and the (only for a
    // low-readiness result) coach-notification lookups all run in the
    // background instead of the button sitting on "Save" through 1-3
    // sequential round-trips first.
    setSaved(values);
    setEditing(false);
    onSaved?.(values);

    const trimmedLifeImpactNote = lifeImpactNote.trim();

    supabase
      .from("wellness_checkins")
      .upsert(
        {
          athlete_id: athleteId,
          group_id: groupId,
          log_date: todayDate,
          sleep_quality: values.sleepQuality,
          soreness: values.soreness,
          energy: values.energy,
          ...(lifeImpactPrompt ? { life_impact_prompt: lifeImpactPrompt } : {}),
          ...(trimmedLifeImpactNote ? { life_impact_note: trimmedLifeImpactNote } : {}),
        },
        { onConflict: "athlete_id,group_id,log_date" }
      )
      .then(({ error: upsertError }) => {
        if (upsertError) {
          setSaved(previousSaved);
          setEditing(true);
          setError("Couldn't save — check your connection and try again.");
          return;
        }

        // Low readiness genuinely can't wait for a digest — push the coach
        // immediately, same 1-on-1-only tier gate the workout-completion
        // push already uses (complete-workout-button.tsx) so a coach
        // running a large team isn't flooded with every routine check-in.
        if (!isLowReadiness(values)) return;
        Promise.all([
          supabase.from("group_memberships").select("client_tier").eq("group_id", groupId).eq("profile_id", athleteId).maybeSingle(),
          supabase.from("profiles").select("full_name").eq("id", athleteId).maybeSingle(),
        ]).then(([{ data: membership }, { data: profile }]) => {
          if (!isHighPriorityClient(membership?.client_tier ?? null)) return;
          supabase
            .from("group_memberships")
            .select("profile_id")
            .eq("group_id", groupId)
            .eq("role", "coach")
            .limit(1)
            .maybeSingle()
            .then(({ data: coachMembership }) => {
              if (!coachMembership) return;
              const athleteName = profile?.full_name ?? "Your client";
              notifyPush(
                coachMembership.profile_id,
                "Low readiness flagged",
                `${athleteName} logged low readiness today`,
                `/groups/${groupId}/clients`
              );
            });
        });
      });
  }

  // One question at a time (Look Refresh, client step, Ron Nov 20): the same three scales and, on the days it is asked, the optional reflection, as "1 of 4".
  // Picking a number moves on to the next question; the last one holds Save. What is saved, and when, is unchanged.
  const totalSteps = FIELDS.length + (lifeImpactPrompt ? 1 : 0);
  const [step, setStep] = useState(0);
  const lastStep = step === totalSteps - 1;
  const field = step < FIELDS.length ? FIELDS[step] : null;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="font-body text-[15px] font-semibold text-chalk">How are you feeling?</h2>
        {(editing || !saved) && (
          <span className="font-body text-xs text-steel tabular-nums" data-checkin-step>
            {step + 1} of {totalSteps}
          </span>
        )}
      </div>

      {error && (
        <p className="font-body text-xs text-rust mb-2" role="alert">
          {error}
        </p>
      )}

      {!editing && saved ? (
        <div className="flex items-center justify-between">
          <p className="font-body text-sm text-chalk">
            {FIELDS.map((f) => `${f.label.split(" ")[0]} ${f.flipped ? sorenessShown(saved[f.key]) : saved[f.key]}`).join(" · ")}
          </p>
          <button
            type="button"
            onClick={() => {
              setDraft(saved);
              setStep(0);
              setEditing(true);
            }}
            className="inline-flex items-center min-h-11 px-2 font-body text-xs text-rust"
          >
            Edit
          </button>
        </div>
      ) : (
        <div className="space-y-4" data-checkin-one-at-a-time>
          {field && (
            <div key={field.key}>
              <p className="font-body text-sm font-semibold text-chalk mb-2">{field.label}</p>
              <div className="flex items-center gap-1.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-label={`${field.label}: ${n} of 5${n === 1 ? ` (${field.lowLabel})` : n === 5 ? ` (${field.highLabel})` : ""}`}
                    aria-pressed={draft[field.key] === (field.flipped ? sorenessStored(n) : n)}
                    onClick={() => {
                      setDraft((prev) => ({ ...prev, [field.key]: field.flipped ? sorenessStored(n) : n }));
                      if (!lastStep) setStep((s) => Math.min(s + 1, totalSteps - 1));
                    }}
                    className={`flex-1 h-11 rounded-row font-body text-[15px] font-medium ${
                      draft[field.key] === (field.flipped ? sorenessStored(n) : n)
                        ? "bg-rust text-graphite"
                        : "bg-surface-2 text-chalk"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="flex justify-between mt-1">
                <span className="font-body text-xs text-steel">{field.lowLabel}</span>
                <span className="font-body text-xs text-steel">{field.highLabel}</span>
              </div>
            </div>
          )}

          {!field && lifeImpactPrompt && (
            <div>
              <p className="font-body text-sm font-semibold text-chalk mb-2">{lifeImpactPrompt}</p>
              {!lifeImpactDismissed && (
                <>
                  <textarea aria-label="Your answer (optional)"
                    value={lifeImpactNote}
                    onChange={(e) => setLifeImpactNote(e.target.value)}
                    placeholder="Totally optional — only if something comes to mind."
                    rows={2}
                    className="w-full rounded-row bg-surface-2 border border-steel/30 text-chalk px-3 py-2 font-body text-sm focus:outline-none focus:border-rust"
                  />
                  <button
                    type="button"
                    onClick={() => setLifeImpactDismissed(true)}
                    className="font-body text-xs text-steel mt-1 inline-flex items-center min-h-11"
                  >
                    Skip this
                  </button>
                </>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            {step > 0 && (
              <button type="button" onClick={() => setStep((s) => Math.max(0, s - 1))} className="h-11 px-4 rounded-row bg-surface-2 font-body text-sm text-chalk">
                Back
              </button>
            )}
            {lastStep ? (
              <button
                type="button"
                onClick={handleSave}
                disabled={!complete}
                className="flex-1 h-11 bg-rust text-graphite font-body text-sm font-semibold disabled:opacity-40"
              >
                Save
              </button>
            ) : (
              field &&
              draft[field.key] != null && (
                <button type="button" onClick={() => setStep((s) => Math.min(s + 1, totalSteps - 1))} className="flex-1 h-11 rounded-row bg-surface-2 font-body text-sm text-chalk">
                  Next
                </button>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
