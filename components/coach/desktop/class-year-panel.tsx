"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { parseGraduationYear, hasGraduatedBy, graduatedByYear } from "@/lib/graduation";

export interface ClassYearPlayer {
  profileId: string;
  fullName: string;
  graduationYear: number | null;
}

// The year each player graduates ("class of 2027"). When next season is started, players whose class has graduated start unticked and are emailed their own training history. Saved when the box is left; empty clears it.
export function ClassYearPanel({ groupId, players }: { groupId: string; players: ClassYearPlayer[] }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(players.map((p) => [p.profileId, p.graduationYear ? String(p.graduationYear) : ""])));
  const [saved, setSaved] = useState<Record<string, number | null>>(() => Object.fromEntries(players.map((p) => [p.profileId, p.graduationYear])));
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function save(p: ClassYearPlayer) {
    const parsed = parseGraduationYear(values[p.profileId] ?? "");
    if (!parsed.ok) {
      setErrors((e) => ({ ...e, [p.profileId]: "Use a four-digit year, like 2027." }));
      return;
    }
    if (parsed.value === saved[p.profileId]) {
      setErrors((e) => ({ ...e, [p.profileId]: "" }));
      return;
    }
    const { data: updated, error } = await createBrowserClient().from("group_memberships").update({ graduation_year: parsed.value }).eq("group_id", groupId).eq("profile_id", p.profileId).eq("role", "athlete").select("profile_id");
    if (error || (updated ?? []).length === 0) {
      setErrors((e) => ({ ...e, [p.profileId]: "Couldn't save. Try again." }));
      return;
    }
    setSaved((s) => ({ ...s, [p.profileId]: parsed.value }));
    setErrors((e) => ({ ...e, [p.profileId]: "" }));
  }

  if (players.length === 0) return null;
  return (
    <details className="mt-4 max-w-xl">
      <summary className="font-body text-sm text-steel cursor-pointer">Class years (who graduates when)</summary>
      <p className="font-body text-xs text-steel mt-2">
        Players whose class has graduated start unticked when you start next season, and each is emailed a PDF of their own training history (to their own address only).
      </p>
      <div className="mt-2 border border-steel/20 max-h-64 overflow-y-auto">
        {players.map((p) => (
          <div key={p.profileId} className="flex items-center gap-3 px-3 py-2 border-b border-steel/10 last:border-b-0 font-body text-sm">
            <label htmlFor={`class-year-${p.profileId}`} className="flex-1 truncate">
              {p.fullName}
            </label>
            {saved[p.profileId] && hasGraduatedBy(saved[p.profileId], graduatedByYear()) ? <span className="text-xs text-steel">graduated</span> : null}
            <input
              id={`class-year-${p.profileId}`}
              inputMode="numeric"
              maxLength={4}
              placeholder="Class of"
              value={values[p.profileId] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [p.profileId]: e.target.value }))}
              onBlur={() => save(p)}
              className="w-24 h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-base sm:text-sm"
            />
            {errors[p.profileId] ? (
              <span className="text-xs text-rust" role="alert">
                {errors[p.profileId]}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </details>
  );
}
