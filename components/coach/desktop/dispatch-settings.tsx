"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { Copy, Check } from "lucide-react";

// org_calendar_spotter_trainer_dispatch_scoping_sept19.md — the two
// coach-facing controls this feature needs: the public intake link to
// actually share (a real gym would put this on their website/socials),
// and the gym-owner-configurable cascade TTL (Ron's own resolution —
// not a hardcoded constant).
export function DispatchSettings({
  organizationId,
  orgSlug,
  initialTtlMinutes,
}: {
  organizationId: string;
  orgSlug: string;
  initialTtlMinutes: number;
}) {
  const [ttlMinutes, setTtlMinutes] = useState(initialTtlMinutes);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const intakeUrl = typeof window !== "undefined" ? `${window.location.origin}/join/${orgSlug}` : `/join/${orgSlug}`;

  async function persistTtl(next: number) {
    setSaving(true);
    const supabase = createBrowserClient();
    await supabase.from("organizations").update({ dispatch_ttl_minutes: next }).eq("id", organizationId);
    setSaving(false);
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(intakeUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access denied — non-fatal, the link is still selectable text.
    }
  }

  return (
    <div className="mb-8 border border-steel/20 p-4 max-w-xl">
      <p className="font-body text-[11px] text-steel uppercase tracking-wide mb-2">
        Trainer request page
      </p>
      <p className="font-body text-xs text-steel mb-2 max-w-[60ch]">
        Share this link on your website or socials — a prospect requests a day/time and goal, and
        we cascade the request to whichever of your trainers is actually available, best fit first.
      </p>
      <div className="flex items-center gap-2">
        <input
          type="text"
          readOnly
          value={intakeUrl}
          className="flex-1 h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs"
        />
        <button
          type="button"
          onClick={handleCopy}
          className="h-9 px-3 flex items-center gap-1.5 border border-steel/30 text-steel font-body text-xs active:text-rust"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <label className="flex items-center gap-2 mt-4">
        <span className="font-body text-[11px] text-steel uppercase tracking-wide">
          Trainer response window
        </span>
        <input
          type="number"
          min={1}
          value={ttlMinutes}
          onChange={(e) => setTtlMinutes(Number(e.target.value))}
          onBlur={() => persistTtl(ttlMinutes)}
          disabled={saving}
          className="w-20 h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm disabled:opacity-50"
        />
        <span className="font-body text-xs text-steel">minutes before moving to the next trainer</span>
      </label>
    </div>
  );
}
