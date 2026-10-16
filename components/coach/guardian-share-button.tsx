"use client";

import { confirmDialog } from "@/components/shared/confirm-dialog";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { appOriginBrowser } from "@/lib/app-url";

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
  initialExpiresAt = null,
}: {
  athleteId: string;
  groupId: string;
  consentVerified: boolean;
  initialToken: string | null;
  initialExpiresAt?: string | null;
}) {
  const router = useRouter();
  const [token, setToken] = useState(initialToken);
  const [expiresAt, setExpiresAt] = useState(initialExpiresAt);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleCreate() {
    setBusy(true);
    setError(null);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusy(false);
      return;
    }
    // The secret in the link is made by the database (whatever is sent is ignored) and read back here.
    const { data, error } = await supabase
      .from("guardian_links")
      .insert({
        athlete_id: athleteId,
        group_id: groupId,
        created_by: user.id,
      })
      .select("access_token, expires_at")
      .single();
    const made = data as { access_token?: string; expires_at?: string | null } | null;
    if (error || !made?.access_token) {
      setError("Couldn't make the link. A parent link can only be made for a client under 13 in a group you coach, after parental consent is verified.");
    } else {
      setToken(made.access_token);
      setExpiresAt(made.expires_at ?? null);
      router.refresh();
    }
    setBusy(false);
  }

  async function handleRevoke() {
    if (!token) return;
    if (!await confirmDialog("Revoke this parent link? The page will stop working immediately.")) return;
    setBusy(true);
    const supabase = createBrowserClient();
    await supabase
      .from("guardian_links")
      .update({ revoked_at: new Date().toISOString() })
      .eq("athlete_id", athleteId)
      .eq("access_token", token);
    setToken(null);
    setExpiresAt(null);
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
    const url = typeof window !== "undefined" ? `${appOriginBrowser()}/guardian/${token}` : `/guardian/${token}`;
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
        {expiresAt && (
          <p className="font-body text-xs text-steel">
            Works until {new Date(expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}. After that, make a new link.
          </p>
        )}
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
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleCreate}
        disabled={busy}
        className="h-9 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
      >
        {busy ? "Creating…" : "Share with parent"}
      </button>
      {error && (
        <p className="font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
