"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

export function SuggestionSettings({
  coachId,
  initialMode,
  initialLeadDays,
}: {
  coachId: string;
  initialMode: "list" | "auto_add";
  initialLeadDays: number;
}) {
  const router = useRouter();
  const [mode, setMode] = useState(initialMode);
  const [leadDays, setLeadDays] = useState(String(initialLeadDays));
  const [saving, setSaving] = useState(false);

  async function persist(nextMode: "list" | "auto_add", nextLeadDays: number) {
    setSaving(true);
    const supabase = createBrowserClient();
    await supabase.from("coach_preferences").upsert(
      { coach_id: coachId, suggestion_mode: nextMode, suggestion_lead_days: nextLeadDays },
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
              persist("list", Number(leadDays) || 3);
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
              persist("auto_add", Number(leadDays) || 3);
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
        <label className="flex items-center gap-2">
          <span className="font-body text-xs text-steel">Remind me</span>
          <input
            type="number"
            min={0}
            value={leadDays}
            onChange={(e) => setLeadDays(e.target.value)}
            onBlur={() => persist(mode, Number(leadDays) || 3)}
            className="w-14 h-8 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs"
          />
          <span className="font-body text-xs text-steel">days before a program ends</span>
        </label>
      </div>
    </div>
  );
}
