"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

// equipment_qr_decal_scoping_sept19.md — the walk-in/non-member join
// CTA. Calls submit_gym_visitor_lead (security-definer RPC, migration
// 0199) rather than inserting directly — same "anon RPC does its own
// validation, no anon INSERT policy" shape as book_discovery_call
// (migration 0089).
export function GymVisitorLeadForm({
  organizationId,
  exerciseLibraryId,
  orgName,
}: {
  organizationId: string;
  exerciseLibraryId: string;
  orgName: string;
}) {
  const [fullName, setFullName] = useState("");
  const [contactInfo, setContactInfo] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim() || !contactInfo.trim()) return;
    setSubmitting(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: rpcError } = await supabase.rpc("submit_gym_visitor_lead", {
      p_organization_id: organizationId,
      p_exercise_library_id: exerciseLibraryId,
      p_full_name: fullName,
      p_contact_info: contactInfo,
      p_note: note || null,
    });
    setSubmitting(false);
    if (rpcError) {
      setError("Something went wrong — try again in a moment.");
      return;
    }
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="mt-6 p-4 border border-rust/40 bg-surface/60 text-center">
        <p className="font-body text-sm text-chalk">
          Thanks, {fullName.split(" ")[0]}! Someone from {orgName} will reach out soon.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-3">
      <p className="font-display uppercase text-sm tracking-wide text-rust text-center">
        Join {orgName}
      </p>
      <p className="font-body text-xs text-steel text-center">
        Interested in training here? Leave your info and we&apos;ll follow up.
      </p>
      <input
        type="text"
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
        placeholder="Your name"
        required
        className="w-full h-11 bg-surface border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
      />
      <input
        type="text"
        value={contactInfo}
        onChange={(e) => setContactInfo(e.target.value)}
        placeholder="Phone or email"
        required
        className="w-full h-11 bg-surface border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
      />
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What are you looking to work on? (optional)"
        rows={2}
        className="w-full bg-surface border border-steel/30 text-chalk px-3 py-2 font-body text-sm focus:outline-none focus:border-rust"
      />
      {error && (
        <p className="font-body text-xs text-rust text-center" role="alert">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={submitting || !fullName.trim() || !contactInfo.trim()}
        className="w-full h-12 bg-rust text-graphite font-display uppercase text-sm font-bold disabled:opacity-40"
      >
        {submitting ? "Sending…" : "I'm interested"}
      </button>
    </form>
  );
}
