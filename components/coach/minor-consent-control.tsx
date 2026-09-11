"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

type Method = "signed_form" | "phone_or_video_call" | "email" | "other";

const METHOD_LABELS: Record<Method, string> = {
  signed_form: "Signed form",
  phone_or_video_call: "Phone or video call",
  email: "Email",
  other: "Other",
};

export function MinorConsentControl({
  athleteId,
  groupId,
  initialVerified,
  initialMethod,
  initialNotes,
  initialVerifiedAt,
}: {
  athleteId: string;
  groupId: string;
  initialVerified: boolean;
  initialMethod: Method | null;
  initialNotes: string;
  initialVerifiedAt: string | null;
}) {
  const [verified, setVerified] = useState(initialVerified);
  const [method, setMethod] = useState<Method>(initialMethod ?? "signed_form");
  const [notes, setNotes] = useState(initialNotes);
  const [verifiedAt, setVerifiedAt] = useState(initialVerifiedAt);
  const [saving, setSaving] = useState(false);

  async function persist(nextVerified: boolean) {
    setSaving(true);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const now = new Date().toISOString();

    await supabase.from("minor_consent").upsert(
      {
        athlete_id: athleteId,
        group_id: groupId,
        verified: nextVerified,
        verified_by: nextVerified ? user?.id ?? null : null,
        verified_at: nextVerified ? now : null,
        method,
        notes: notes.trim() || null,
      },
      { onConflict: "athlete_id" }
    );

    setVerified(nextVerified);
    setVerifiedAt(nextVerified ? now : null);
    setSaving(false);
  }

  return (
    <div className="border border-rust/40 p-4 space-y-3">
      <h2 className="font-display uppercase text-sm tracking-wide text-rust">
        Parental consent (under 13)
      </h2>
      <p className="font-body text-xs text-steel">
        This athlete reported a birthdate under 13. U.S. law (COPPA) requires verified parental
        consent before their program access unlocks — this athlete cannot verify it themselves.
      </p>

      {verified ? (
        <p className="font-body text-sm">
          ✓ Verified — {METHOD_LABELS[method]}
          {verifiedAt ? `, ${new Date(verifiedAt).toLocaleDateString()}` : ""}
        </p>
      ) : (
        <p className="font-body text-sm text-rust">⚠ Not yet verified</p>
      )}

      <label className="block">
        <span className="font-body text-xs text-steel uppercase tracking-wide">
          How was consent obtained?
        </span>
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value as Method)}
          className="w-full h-9 mt-1 bg-surface border border-steel/30 text-chalk px-2 font-body text-sm"
        >
          {(Object.keys(METHOD_LABELS) as Method[]).map((m) => (
            <option key={m} value={m}>
              {METHOD_LABELS[m]}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="font-body text-xs text-steel uppercase tracking-wide">Notes</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Who you spoke with, when, any relevant details"
          className="w-full mt-1 bg-surface border border-steel/30 text-chalk px-2 py-1.5 font-body text-sm resize-none"
        />
      </label>

      <button
        type="button"
        onClick={() => persist(!verified)}
        disabled={saving}
        className={`w-full h-9 font-body text-sm font-medium disabled:opacity-40 ${
          verified
            ? "border border-steel/30 text-steel"
            : "bg-rust text-graphite"
        }`}
      >
        {saving ? "Saving…" : verified ? "Undo verification" : "Mark parental consent verified"}
      </button>
    </div>
  );
}
