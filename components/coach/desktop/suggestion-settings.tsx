"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type LeadMode = "days_before" | "weekday_before";

export function SuggestionSettings({
  coachId,
  initialMode,
  initialLeadDays,
  initialLeadMode,
  initialLeadWeekday,
}: {
  coachId: string;
  initialMode: "list" | "auto_add";
  initialLeadDays: number;
  initialLeadMode: LeadMode;
  initialLeadWeekday: number | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState(initialMode);
  const [leadDays, setLeadDays] = useState(String(initialLeadDays));
  const [leadMode, setLeadMode] = useState<LeadMode>(initialLeadMode);
  const [leadWeekday, setLeadWeekday] = useState(initialLeadWeekday ?? 5);
  const [saving, setSaving] = useState(false);

  async function persist(patch: {
    mode?: "list" | "auto_add";
    leadDays?: number;
    leadMode?: LeadMode;
    leadWeekday?: number;
  }) {
    setSaving(true);
    const supabase = createBrowserClient();
    await supabase.from("coach_preferences").upsert(
      {
        coach_id: coachId,
        suggestion_mode: patch.mode ?? mode,
        suggestion_lead_days: patch.leadDays ?? (Number(leadDays) || 3),
        suggestion_lead_mode: patch.leadMode ?? leadMode,
        suggestion_lead_weekday: patch.leadWeekday ?? leadWeekday,
      },
      { onConflict: "coach_id" }
    );
    setSaving(false);
    router.refresh();
  }

  return (
    <div className="border border-steel/20 bg-surface/40 p-4 mb-4">
      <p className="font-body text-xs text-steel uppercase tracking-wide mb-2">
        Suggestion settings
      </p>
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setMode("list");
              persist({ mode: "list" });
            }}
            disabled={saving}
            className={`h-8 px-3 font-body text-xs border ${
              mode === "list"
                ? "bg-rust text-graphite border-rust"
                : "border-steel/30 text-steel active:border-rust active:text-rust"
            }`}
          >
            Show me a list
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("auto_add");
              persist({ mode: "auto_add" });
            }}
            disabled={saving}
            className={`h-8 px-3 font-body text-xs border ${
              mode === "auto_add"
                ? "bg-rust text-graphite border-rust"
                : "border-steel/30 text-steel active:border-rust active:text-rust"
            }`}
          >
            Auto-add to my calendar
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setLeadMode("days_before");
              persist({ leadMode: "days_before" });
            }}
            disabled={saving}
            className={`h-8 px-3 font-body text-xs border ${
              leadMode === "days_before"
                ? "bg-rust text-graphite border-rust"
                : "border-steel/30 text-steel active:border-rust active:text-rust"
            }`}
          >
            N days before
          </button>
          <button
            type="button"
            onClick={() => {
              setLeadMode("weekday_before");
              persist({ leadMode: "weekday_before" });
            }}
            disabled={saving}
            className={`h-8 px-3 font-body text-xs border ${
              leadMode === "weekday_before"
                ? "bg-rust text-graphite border-rust"
                : "border-steel/30 text-steel active:border-rust active:text-rust"
            }`}
          >
            A specific weekday
          </button>
        </div>

        {leadMode === "days_before" ? (
          <label className="flex items-center gap-2">
            <span className="font-body text-xs text-steel">Remind me</span>
            <input
              type="number"
              min={0}
              value={leadDays}
              onChange={(e) => setLeadDays(e.target.value)}
              onBlur={() => persist({ leadDays: Number(leadDays) || 3 })}
              className="w-14 h-8 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs"
            />
            <span className="font-body text-xs text-steel">days before a program ends</span>
          </label>
        ) : (
          <label className="flex items-center gap-2">
            <span className="font-body text-xs text-steel">Remind me the</span>
            <select
              value={leadWeekday}
              onChange={(e) => {
                const wd = Number(e.target.value);
                setLeadWeekday(wd);
                persist({ leadWeekday: wd });
              }}
              className="h-8 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs"
            >
              {WEEKDAY_LABELS.map((label, wd) => (
                <option key={wd} value={wd}>
                  {label}
                </option>
              ))}
            </select>
            <span className="font-body text-xs text-steel">before a program ends</span>
          </label>
        )}
      </div>
    </div>
  );
}
