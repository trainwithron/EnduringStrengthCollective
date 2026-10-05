"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { saveStandingTarget } from "@/lib/standing-macros";
import { localDateKey } from "@/lib/timezone";

interface Target {
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}

const FIELDS: { key: keyof Target; label: string; unit: string; max: number }[] = [
  { key: "calories", label: "Calories", unit: "kcal", max: 20000 },
  { key: "proteinG", label: "Protein", unit: "g", max: 1500 },
  { key: "carbsG", label: "Carbs", unit: "g", max: 3000 },
  { key: "fatG", label: "Fat", unit: "g", max: 1500 },
];

function toDraft(t: Target | null): Record<keyof Target, string> {
  return {
    calories: t?.calories != null ? String(t.calories) : "",
    proteinG: t?.proteinG != null ? String(t.proteinG) : "",
    carbsG: t?.carbsG != null ? String(t.carbsG) : "",
    fatG: t?.fatG != null ? String(t.fatG) : "",
  };
}

function formatShortDate(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// One target that applies to this client every day, unless the coach sets
// something different for a specific date (those day-level numbers are
// "overrides" and win). Targets-only clients need nothing else.
export function StandingMacroTargetCard({
  athleteId,
  groupId,
  initial,
  latestExplicit,
  upcomingOverrides,
  calendarHref,
}: {
  athleteId: string;
  groupId: string;
  initial: Target | null;
  // The most recent per-day target already saved for this client, offered (never
  // forced) as a starting point when there is no standing target yet.
  latestExplicit: { date: string; calories: number } | null;
  upcomingOverrides: { date: string; calories: number }[];
  calendarHref: string;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState<Target | null>(initial);
  const [draft, setDraft] = useState(toDraft(initial));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(saved));

  function parse(): Target | string {
    const out: Target = { calories: null, proteinG: null, carbsG: null, fatG: null };
    for (const f of FIELDS) {
      const raw = draft[f.key].trim();
      if (raw === "") continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > f.max) {
        return `${f.label} must be a whole number from 0 to ${f.max}.`;
      }
      out[f.key] = n;
    }
    if (out.calories == null && out.proteinG == null && out.carbsG == null && out.fatG == null) {
      return "Enter at least one number, or use Remove to clear the standing target.";
    }
    return out;
  }

  async function handleSave() {
    setError(null);
    setMessage(null);
    const parsed = parse();
    if (typeof parsed === "string") {
      setError(parsed);
      return;
    }
    setBusy(true);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const result = await saveStandingTarget(supabase, {
      athleteId,
      groupId,
      userId: user?.id ?? null,
      target: parsed,
      today: localDateKey(),
    });
    setBusy(false);
    if (!result.ok) {
      setError("Couldn't save the standing target. Check your connection and try again.");
      return;
    }
    setSaved(parsed);
    setDraft(toDraft(parsed));
    setMessage("Saved. It applies from today on. Earlier days keep the target they had.");
    router.refresh();
  }

  async function handleRemove() {
    if (!window.confirm("Remove the standing target? Days with their own target keep it. Other days will have none.")) return;
    setError(null);
    setMessage(null);
    setBusy(true);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const result = await saveStandingTarget(supabase, {
      athleteId,
      groupId,
      userId: user?.id ?? null,
      target: null,
      today: localDateKey(),
    });
    setBusy(false);
    if (!result.ok) {
      setError("Couldn't remove it. Try again.");
      return;
    }
    setSaved(null);
    setDraft(toDraft(null));
    setMessage("Standing target removed.");
    router.refresh();
  }

  return (
    <div className="border border-steel/20 bg-surface/40 p-4 mb-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-display uppercase text-sm tracking-wide">Standing target</h3>
        <span className="font-body text-xs text-steel">{saved ? "Active" : "Not set"}</span>
      </div>
      <p className="font-body text-xs text-steel mt-1 max-w-[56ch]">
        Applies every day unless you set a different one for a date. A meal plan on a day shows its own meals, but
        a target you set for that day wins.
      </p>

      <div className="grid grid-cols-2 gap-3 mt-3">
        {FIELDS.map((f) => (
          <label key={f.key} className="block">
            <span className="font-body text-xs text-steel">
              {f.label} ({f.unit})
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={f.max}
              value={draft[f.key]}
              onChange={(e) => {
                setDraft((prev) => ({ ...prev, [f.key]: e.target.value }));
                setError(null);
                setMessage(null);
              }}
              className="mt-1 w-full h-11 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
            />
          </label>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 mt-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={busy || !dirty}
          className="h-11 px-5 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
        >
          {busy ? "Saving…" : saved ? "Update standing target" : "Save standing target"}
        </button>
        {saved && (
          <button
            type="button"
            onClick={handleRemove}
            disabled={busy}
            className="h-11 px-4 border border-steel/30 text-steel font-body text-sm disabled:opacity-40"
          >
            Remove
          </button>
        )}
        {message && <span className="font-body text-xs text-positive">{message}</span>}
      </div>
      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}

      {!saved && latestExplicit && (
        <div className="mt-3 border-t border-steel/20 pt-3">
          <p className="font-body text-xs text-steel">
            This client already has per-day targets. The latest is {latestExplicit.calories} kcal on{" "}
            {formatShortDate(latestExplicit.date)}.
          </p>
          <button
            type="button"
            onClick={() => {
              setDraft((prev) => ({ ...prev, calories: String(latestExplicit.calories) }));
              setMessage(null);
            }}
            className="h-11 mt-1 font-body text-sm text-rust"
          >
            Start from {latestExplicit.calories} kcal &rarr;
          </button>
        </div>
      )}

      <div className="mt-3 border-t border-steel/20 pt-3">
        {upcomingOverrides.length === 0 ? (
          <p className="font-body text-xs text-steel">No day-specific targets coming up.</p>
        ) : (
          <p className="font-body text-xs text-steel">
            {upcomingOverrides.length} upcoming {upcomingOverrides.length === 1 ? "day has its" : "days have their"}{" "}
            own target:{" "}
            {upcomingOverrides
              .slice(0, 4)
              .map((o) => `${formatShortDate(o.date)} (${o.calories})`)
              .join(", ")}
            {upcomingOverrides.length > 4 ? ", and more" : ""}.
          </p>
        )}
        <Link href={calendarHref} className="inline-flex items-center h-11 font-body text-sm text-rust">
          Set or change a single day &rarr;
        </Link>
      </div>
    </div>
  );
}
