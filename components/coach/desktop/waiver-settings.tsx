"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { checked } from "@/lib/checked-write";
import { DEFAULT_WAIVER_TEXT } from "@/lib/intake-waiver";
import { WaiverPdfUpload } from "./waiver-pdf-upload";

export function WaiverSettings({
  organizationId,
  initialWaiverText,
  initialWaiverPdfPath,
}: {
  organizationId: string;
  initialWaiverText: string | null;
  initialWaiverPdfPath: string | null;
}) {
  const [text, setText] = useState(initialWaiverText ?? DEFAULT_WAIVER_TEXT);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // "Saved." appears only when the database kept the text (an organization the person does not run would come back with no row and no error).
  async function handleBlur() {
    setSaving(true);
    setSaved(false);
    setError(null);
    const supabase = createBrowserClient();
    const result = await checked(supabase.from("organizations").update({ waiver_text: text }).eq("id", organizationId).select("id"), {
      expectRows: true,
      message: "Couldn't save the waiver text. It was not changed. Try again.",
    });
    setSaving(false);
    if (result.ok) setSaved(true);
    else setError(result.error);
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="border border-rust/40 bg-rust/5 p-3">
        <p className="font-body text-xs text-chalk">
          This is a real starting template, not legal advice — have it reviewed by an attorney for
          your own state/jurisdiction before relying on it.
        </p>
      </div>

      <WaiverPdfUpload organizationId={organizationId} initialPath={initialWaiverPdfPath} />

      <div>
        <span className="font-body text-xs text-steel uppercase tracking-wide">
          Waiver text (used only when no PDF is uploaded above)
        </span>
        <textarea aria-label="Waiver text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={handleBlur}
          rows={14}
          className="w-full mt-1 bg-surface border border-steel/30 text-chalk px-3 py-2 font-body text-sm focus:outline-none focus:border-rust"
        />
        <p className="font-body text-xs text-steel mt-1">
          {saving ? "Saving…" : saved ? "Saved." : ""}
        </p>
        {error && (
          <p className="font-body text-xs text-rust mt-1" role="alert">
            {error}
          </p>
        )}
      </div>

      <p className="font-body text-xs text-steel max-w-[65ch]">
        Every new client added going forward must complete the PAR-Q+ health screening and agree
        to this waiver before they can access their program. Existing clients are unaffected.
      </p>
    </div>
  );
}
