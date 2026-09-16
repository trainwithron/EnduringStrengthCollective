"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

// calorie_tracking_ux_research_and_plan.md — hard-gated on
// minor_consent.verified (passed in, not re-checked here) so this can
// only ever appear once a coach has already verified real parental
// consent for this athlete, same gate MinorConsentControl itself sits
// behind. Deliberately no parent account behind the link this creates —
// see lib/guardian-view.ts's own header comment.
export function GuardianShareButton({
  athleteId,
  groupId,
  consentVerified,
  initialToken,
}: {
  athleteId: string;
  groupId: string;
  consentVerified: boolean;
  initialToken: string | null;
}) {
  const router = useRouter();
  const [token, setToken] = useState(initialToken);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleCreate() {
    setBusy(true);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusy(false);
      return;
    }
    const newToken = crypto.randomUUID();
    const { error } = await supabase.from("guardian_links").insert({
      athlete_id: athleteId,
      group_id: groupId,
      access_token: newToken,
      created_by: user.id,
    });
    if (!error) {
      setToken(newToken);
      router.refresh();
    }
    setBusy(false);
  }

  async function handleRevoke() {
    if (!token) return;
    if (!window.confirm("Revoke this parent link? The page will stop working immediately.")) return;
    setBusy(true);
    const supabase = createBrowserClient();
    await supabase
      .from("guardian_links")
      .update({ revoked_at: new Date().toISOString() })
      .eq("athlete_id", athleteId)
      .eq("access_token", token);
    setToken(null);
    setBusy(false);
    router.refresh();
  }

  if (!consentVerified) {
    return (
      <p className="font-body text-xs text-steel">
        Verify parental consent above before sharing a parent view of this athlete&apos;s day.
      </p>
    );
  }

  if (token) {
    const url = typeof window !== "undefined" ? `${window.location.origin}/guardian/${token}` : `/guardian/${token}`;
    return (
      <div className="space-y-2">
        <p className="font-body text-xs text-steel uppercase tracking-wide">Parent view link</p>
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 h-9 bg-surface border border-steel/30 text-chalk px-2 font-body text-xs"
          />
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="h-9 px-3 bg-rust text-graphite font-body text-xs font-medium shrink-0"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <button
          type="button"
          onClick={handleRevoke}
          disabled={busy}
          className="font-body text-xs text-steel active:text-rust transition-colors disabled:opacity-40"
        >
          Revoke this link
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={handleCreate}
      disabled={busy}
      className="h-9 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
    >
      {busy ? "Creating…" : "Share with parent"}
    </button>
  );
}
