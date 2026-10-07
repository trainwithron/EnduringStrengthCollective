"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { ACTIVITY_LEVELS, SHORT_ACTIVITY_LABELS, type ActivityKey } from "@/lib/client-body-profile";
import { shortDateLabel } from "@/lib/apply-from";
import { cmToFtIn, formatWeight, parseHeightInput, type WeightUnit } from "@/lib/units";

const selectClass = "h-10 bg-surface border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust";
const inputClass = "h-10 w-32 bg-surface border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust";

const heightText = (cm: number | null, unit: WeightUnit): string => {
  if (cm == null) return "";
  if (unit === "kg") return String(Math.round(cm));
  const { ft, inches } = cmToFtIn(cm);
  return `${ft}'${inches}`;
};

// The calculator's inputs for one client, edited by their coach. Saved through coach_set_body_profile (a database function), never straight to the client's profile row,
// so a coach can change these and nothing else of theirs (bio, phone). The weight is the client's own log; the date of birth comes from their intake or About you.
export function BodyProfileEditor({
  athleteId,
  groupId,
  clientName,
  initial,
  dateOfBirthLabel,
  latestWeightLbs,
  latestWeightDate,
}: {
  athleteId: string;
  groupId: string;
  clientName: string;
  initial: { heightCm: number | null; sex: "male" | "female" | null; bodyFatPct: number | null; activity: ActivityKey | null; weightUnit: WeightUnit };
  // "Jan 2, 1996" with where it came from, or null when nobody has given one.
  dateOfBirthLabel: string | null;
  latestWeightLbs: number | null;
  latestWeightDate: string | null;
}) {
  const router = useRouter();
  const [unit, setUnit] = useState<WeightUnit>(initial.weightUnit);
  const [height, setHeight] = useState(heightText(initial.heightCm, initial.weightUnit));
  const [sex, setSex] = useState<"male" | "female" | "">(initial.sex ?? "");
  const [activity, setActivity] = useState<ActivityKey | "">(initial.activity ?? "");
  const [bodyFat, setBodyFat] = useState(initial.bodyFatPct != null ? String(initial.bodyFatPct) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function save() {
    setError(null);
    setMessage(null);
    const heightCm = height.trim() ? parseHeightInput(height, unit) : null;
    if (height.trim() && heightCm == null) return setError(unit === "lb" ? "Height looks wrong. Try 5'10 or 178 cm." : "Height looks wrong. Try 178 (centimetres).");
    let bodyFatPct: number | null = null;
    const clearBodyFat = !bodyFat.trim() && initial.bodyFatPct != null;
    if (bodyFat.trim()) {
      bodyFatPct = Number(bodyFat.replace(",", "."));
      if (!Number.isFinite(bodyFatPct) || bodyFatPct < 3 || bodyFatPct > 60) return setError("Body fat should be between 3 and 60 percent, or blank.");
    }
    setBusy(true);
    const supabase = createBrowserClient();
    const { error: rpcError } = await supabase.rpc("coach_set_body_profile", {
      p_athlete: athleteId,
      p_group: groupId,
      p_height_cm: heightCm,
      p_sex: sex || null,
      p_body_fat_pct: bodyFatPct,
      p_activity: activity || null,
      p_weight_unit: unit,
      p_portion_units: null,
      p_clear_body_fat: clearBodyFat,
    });
    setBusy(false);
    if (rpcError) return setError(rpcError.message || "Couldn't save. Try again.");
    setMessage("Saved. Targets use these numbers.");
    router.refresh();
  }

  const summary = [
    initial.heightCm != null ? heightText(initial.heightCm, initial.weightUnit) + (initial.weightUnit === "kg" ? " cm" : "") : "no height",
    initial.sex ?? "sex not given",
    initial.activity ? SHORT_ACTIVITY_LABELS[initial.activity].toLowerCase() : "no activity level",
    initial.bodyFatPct != null ? `${initial.bodyFatPct}% body fat` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="border border-steel/20 p-4 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display font-bold text-sm uppercase tracking-wide text-steel">About {clientName}</h3>
        <button type="button" onClick={() => setOpen((o) => !o)} className="font-body text-xs text-rust">
          {open ? "Close" : "Edit"}
        </button>
      </div>
      <p className="font-body text-sm text-chalk">{summary}</p>
      <p className="font-body text-xs text-steel">
        {latestWeightLbs != null ? `Weight ${formatWeight(latestWeightLbs, initial.weightUnit)}${latestWeightDate ? `, logged ${shortDateLabel(latestWeightDate)}` : ""}.` : "No weight logged yet."}{" "}
        {dateOfBirthLabel ? `Born ${dateOfBirthLabel}.` : "No date of birth on file: ask them to fill in About you."}
      </p>
      {open && (
        <div className="space-y-3 pt-2 border-t border-steel/15">
          <div className="flex flex-wrap gap-4">
            <label className="font-body text-xs text-steel">
              Units
              <select value={unit} onChange={(e) => setUnit(e.target.value as WeightUnit)} className={`${selectClass} block mt-1`}>
                <option value="lb">Pounds, feet and inches</option>
                <option value="kg">Kilograms, centimetres</option>
              </select>
            </label>
            <label className="font-body text-xs text-steel">
              Height {unit === "lb" ? "(5'10)" : "(cm)"}
              <input value={height} onChange={(e) => setHeight(e.target.value)} className={`${inputClass} block mt-1`} />
            </label>
            <label className="font-body text-xs text-steel">
              Sex
              <select value={sex} onChange={(e) => setSex(e.target.value as "male" | "female" | "")} className={`${selectClass} block mt-1`}>
                <option value="">{initial.sex ? "Keep as is" : "Not given"}</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </label>
            <label className="font-body text-xs text-steel">
              Activity
              <select value={activity} onChange={(e) => setActivity(e.target.value as ActivityKey | "")} className={`${selectClass} block mt-1`}>
                <option value="">{initial.activity ? "Keep as is" : "Not given"}</option>
                {ACTIVITY_LEVELS.map((a) => (
                  <option key={a} value={a}>
                    {SHORT_ACTIVITY_LABELS[a]}
                  </option>
                ))}
              </select>
            </label>
            <label className="font-body text-xs text-steel">
              Body fat % (optional)
              <input value={bodyFat} onChange={(e) => setBodyFat(e.target.value)} inputMode="decimal" className={`${inputClass} block mt-1 w-24`} />
            </label>
          </div>
          <p className="font-body text-xs text-steel">Leave a box as it is to keep what is saved. Only the client can take back a sex or activity they gave.</p>
          {error && (
            <p className="font-body text-xs text-rust" role="alert">
              {error}
            </p>
          )}
          {message && <p className="font-body text-xs text-positive">{message}</p>}
          <button type="button" onClick={save} disabled={busy} className="h-9 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}
