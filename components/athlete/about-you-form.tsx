"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";
import { localDateKey } from "@/lib/date-key";
import { ACTIVITY_LABELS, ACTIVITY_LEVELS, type ActivityKey } from "@/lib/client-body-profile";
import { ONBOARDING_GOALS, type GoalType } from "@/lib/goal-to-nutrition-phase";
import { cmToFtIn, displayWeightValue, parseHeightInput, parseWeightInput, type WeightUnit } from "@/lib/units";

export interface AboutYouInitial {
  unit: WeightUnit;
  heightCm: number | null;
  sex: "male" | "female" | null;
  activity: ActivityKey | null;
  bodyFatPct: number | null;
  weightLbs: number | null;
  // The date of birth is asked only when neither the intake nor the profile has one: never twice.
  dateOfBirthKnown: boolean;
  hasGoal: boolean;
}

const heightText = (cm: number | null, unit: WeightUnit): string => {
  if (cm == null) return "";
  if (unit === "kg") return String(Math.round(cm));
  const { ft, inches } = cmToFtIn(cm);
  return `${ft}'${inches}`;
};

const weightText = (lbs: number | null, unit: WeightUnit): string => (lbs == null ? "" : String(displayWeightValue(lbs, unit)));

const fieldClass = "w-full h-11 bg-surface border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust";
const labelClass = "font-body text-xs text-steel uppercase tracking-wide block mb-1";

// The client's own inputs for the calculator. Everything is skippable; the screen says what each one is for. Weight writes today's body-weight log (one weight, not two).
export function AboutYouForm({ athleteId, groupId, initial }: { athleteId: string; groupId: string; initial: AboutYouInitial }) {
  const router = useRouter();
  const [unit, setUnit] = useState<WeightUnit>(initial.unit);
  const [height, setHeight] = useState(heightText(initial.heightCm, initial.unit));
  const [weight, setWeight] = useState(weightText(initial.weightLbs, initial.unit));
  const [sex, setSex] = useState<"male" | "female" | "none">(initial.sex ?? "none");
  const [dob, setDob] = useState("");
  const [activity, setActivity] = useState<ActivityKey | "">(initial.activity ?? "");
  const [bodyFat, setBodyFat] = useState(initial.bodyFatPct != null ? String(initial.bodyFatPct) : "");
  const [goal, setGoal] = useState<GoalType | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function switchUnit(next: WeightUnit) {
    if (next === unit) return;
    // What they already typed is converted, not lost.
    const cm = parseHeightInput(height, unit);
    const lbs = parseWeightInput(weight, unit);
    setUnit(next);
    if (cm != null) setHeight(heightText(cm, next));
    if (lbs != null) setWeight(weightText(lbs, next));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const heightCm = height.trim() ? parseHeightInput(height, unit) : null;
    if (height.trim() && heightCm == null) return setError(unit === "lb" ? "Height looks wrong. Try 5'10 or 178 cm." : "Height looks wrong. Try 178 (centimetres).");
    const weightLbs = weight.trim() ? parseWeightInput(weight, unit) : null;
    if (weight.trim() && weightLbs == null) return setError("Weight looks wrong. Check the number and the unit.");
    let bodyFatPct: number | null = null;
    if (bodyFat.trim()) {
      bodyFatPct = Number(bodyFat.replace(",", "."));
      if (!Number.isFinite(bodyFatPct) || bodyFatPct < 3 || bodyFatPct > 60) return setError("Body fat should be between 3 and 60 percent, or leave it blank.");
    }
    if (dob) {
      const age = (Date.now() - new Date(`${dob}T00:00:00`).getTime()) / (365.25 * 86400000);
      if (!(age >= 5 && age <= 110)) return setError("Check the date of birth.");
    }
    setBusy(true);
    const supabase = createBrowserClient();
    const profileRow: Record<string, unknown> = {
      athlete_id: athleteId,
      weight_unit: unit,
      activity_level: activity || null,
      biological_sex: sex === "none" ? null : sex,
      height_cm: heightCm,
      updated_at: new Date().toISOString(),
    };
    if (!initial.dateOfBirthKnown && dob) profileRow.birthday = dob;
    // Body fat is written only when they touched it, so a number their coach entered is never wiped by leaving it blank.
    if (bodyFat.trim() || initial.bodyFatPct != null) profileRow.body_fat_pct = bodyFatPct;
    const { error: profileError } = await supabase.from("athlete_profile_details").upsert(profileRow, { onConflict: "athlete_id" });
    if (profileError) {
      setBusy(false);
      return setError("Couldn't save. Check your connection and try again.");
    }
    if (weightLbs != null && weightLbs !== (initial.weightLbs == null ? null : Math.round(initial.weightLbs * 100) / 100)) {
      const { error: weightError } = await supabase
        .from("body_weight_logs")
        .upsert({ athlete_id: athleteId, group_id: groupId, logged_date: localDateKey(new Date()), weight: weightLbs }, { onConflict: "athlete_id,logged_date" });
      if (weightError) {
        setBusy(false);
        return setError("Your details saved, but the weight didn't. Try again.");
      }
    }
    if (goal && !initial.hasGoal) {
      // The same row the My Goal page makes: the client proposes, the coach confirms.
      await supabase.from("client_goals").insert({ athlete_id: athleteId, group_id: groupId, goal_type: goal, created_by: athleteId });
    }
    setBusy(false);
    router.push(`/groups/${groupId}`);
    router.refresh();
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <div>
        <span className={labelClass}>Units</span>
        <div className="flex gap-2" role="group" aria-label="Units">
          {(["lb", "kg"] as const).map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => switchUnit(u)}
              aria-pressed={unit === u}
              className={`h-10 px-4 border font-body text-sm ${unit === u ? "border-rust text-chalk" : "border-steel/30 text-steel"}`}
            >
              {u === "lb" ? "Pounds, feet and inches" : "Kilograms, centimetres"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="ay-height" className={labelClass}>
            Height {unit === "lb" ? "(5'10)" : "(cm)"}
          </label>
          <input id="ay-height" className={fieldClass} value={height} onChange={(e) => setHeight(e.target.value)} inputMode="text" autoComplete="off" />
        </div>
        <div>
          <label htmlFor="ay-weight" className={labelClass}>
            Weight today ({unit})
          </label>
          <input id="ay-weight" className={fieldClass} value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="decimal" autoComplete="off" />
        </div>
      </div>

      <div>
        <span className={labelClass}>Sex (the formulas need it)</span>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Sex">
          {(
            [
              ["male", "Male"],
              ["female", "Female"],
              ["none", "Prefer not to say"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setSex(value)}
              aria-pressed={sex === value}
              className={`h-10 px-4 border font-body text-sm ${sex === value ? "border-rust text-chalk" : "border-steel/30 text-steel"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {sex === "none" && <p className="font-body text-xs text-steel mt-1">Your coach&apos;s numbers will use the average of the two formulas, and say so.</p>}
      </div>

      {!initial.dateOfBirthKnown && (
        <div>
          <label htmlFor="ay-dob" className={labelClass}>
            Date of birth
          </label>
          <input id="ay-dob" type="date" className={fieldClass} value={dob} onChange={(e) => setDob(e.target.value)} />
          <p className="font-body text-xs text-steel mt-1">Calorie needs depend on age.</p>
        </div>
      )}

      <fieldset>
        <legend className={labelClass}>How active are you?</legend>
        <div className="space-y-2">
          {ACTIVITY_LEVELS.map((level) => (
            <label key={level} className={`flex items-start gap-3 border px-3 py-3 cursor-pointer font-body text-sm ${activity === level ? "border-rust text-chalk" : "border-steel/30 text-steel"}`}>
              <input type="radio" name="activity" value={level} checked={activity === level} onChange={() => setActivity(level)} className="mt-1" />
              <span>{ACTIVITY_LABELS[level]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {!initial.hasGoal && (
        <fieldset>
          <legend className={labelClass}>What are you working toward? (your coach confirms it)</legend>
          <div className="space-y-2">
            {ONBOARDING_GOALS.map((g) => (
              <label key={g.type} className={`flex items-start gap-3 border px-3 py-3 cursor-pointer font-body text-sm ${goal === g.type ? "border-rust text-chalk" : "border-steel/30 text-steel"}`}>
                <input type="radio" name="goal" value={g.type} checked={goal === g.type} onChange={() => setGoal(g.type)} className="mt-1" />
                <span>
                  <span className="block text-chalk">{g.label}</span>
                  <span className="block text-xs text-steel">{g.hint}</span>
                </span>
              </label>
            ))}
            <label className={`flex items-center gap-3 border px-3 py-3 cursor-pointer font-body text-sm ${goal === "" ? "border-rust text-chalk" : "border-steel/30 text-steel"}`}>
              <input type="radio" name="goal" value="" checked={goal === ""} onChange={() => setGoal("")} />
              <span>Not sure yet</span>
            </label>
          </div>
        </fieldset>
      )}

      <div>
        <label htmlFor="ay-bf" className={labelClass}>
          Body fat percent (optional)
        </label>
        <input id="ay-bf" className={fieldClass} value={bodyFat} onChange={(e) => setBodyFat(e.target.value)} inputMode="decimal" autoComplete="off" placeholder="Skip if you don't know" />
        <p className="font-body text-xs text-steel mt-1">The calculator works fine without it.</p>
      </div>

      {error && (
        <p className="font-body text-sm text-rust" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={busy} className="h-12 px-6 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
          {busy ? "Saving…" : "Save"}
        </button>
        <Link href={`/groups/${groupId}`} className="font-body text-sm text-steel underline underline-offset-2">
          Skip for now
        </Link>
      </div>
    </form>
  );
}
