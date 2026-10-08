"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

// Platform-admin-only: this organization's own AI budget scale (organization_billing.ai_allowance_scale). Blank means the standard rule (a free-access organization gets the
// reduced beta share, a paid one gets the full budget); 1 means the full standard budget even for a free-access organization; 0.3 is the beta share; 0 turns AI off for them.
// Writes straight to organization_billing: RLS only lets the platform admin do that. The upsert names only its own columns, so it never touches the free-access flag.
export function OrgAiScaleControl({ organizationId, initialScale }: { organizationId: string; initialScale: number | null }) {
  const [text, setText] = useState(initialScale == null ? "" : String(initialScale));
  const [saved, setSaved] = useState<number | null>(initialScale);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = text.trim();
  const parsed = trimmed === "" ? null : Number(trimmed);
  const valid = parsed === null || (Number.isFinite(parsed) && parsed >= 0 && parsed <= 10);
  const dirty = valid && parsed !== saved;

  async function save() {
    if (busy || !dirty) return;
    setBusy(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: err } = await supabase
      .from("organization_billing")
      .upsert({ organization_id: organizationId, ai_allowance_scale: parsed, updated_at: new Date().toISOString() }, { onConflict: "organization_id" });
    if (err) setError("Couldn't save that.");
    else setSaved(parsed);
    setBusy(false);
  }

  return (
    <div className="shrink-0 text-right">
      <label className="font-body text-xs text-steel block" htmlFor={`ai-scale-${organizationId}`}>
        AI budget scale
      </label>
      <div className="flex items-center gap-1 justify-end mt-1">
        <input
          id={`ai-scale-${organizationId}`}
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
          }}
          placeholder="standard"
          aria-invalid={!valid}
          className="h-8 w-20 bg-transparent border border-steel/30 px-2 font-body text-xs text-chalk text-right"
        />
        <button type="button" onClick={save} disabled={busy || !dirty} className="h-8 px-3 border border-steel/30 font-body text-xs text-steel disabled:opacity-40">
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
      {!valid && (
        <p className="font-body text-xs text-rust mt-1" role="alert">
          Use a number from 0 to 10, or leave it blank.
        </p>
      )}
      {error && (
        <p className="font-body text-xs text-rust mt-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
