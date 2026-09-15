"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { detectTrainingIntent } from "@/lib/training-intent";

export function NewProgramForm({
  groupId,
  createdBy,
  athleteId,
}: {
  groupId: string;
  createdBy: string;
  // Personal-program mode (injury_pain_science_research_and_ai_gap_
  // sept15.md's "Build with AI" entry point also preserves this on the
  // "Start blank" tab) — real bug found during the same-night regression
  // pass: this form never received it, so switching to "Start blank"
  // from a client context silently created a shared program while the
  // page above it still said "Building a personal program for X."
  athleteId?: string | null;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;

    setSubmitting(true);
    setError(null);

    const supabase = createBrowserClient();
    const { data: program, error: insertError } = await supabase
      .from("programs")
      .insert({
        group_id: groupId,
        name: trimmedName,
        description: description.trim() || null,
        created_by: createdBy,
        athlete_id: athleteId ?? null,
        training_intent: detectTrainingIntent(trimmedName),
      })
      .select("id")
      .single();

    if (insertError || !program) {
      setError(insertError?.message ?? "Couldn't create the program.");
      setSubmitting(false);
      return;
    }

    // Single-active-program rule, scoped correctly (same split as
    // lib/program-duplication.ts and import-wizard.tsx's own deactivate
    // query): a personal program only steps down this same client's
    // other personal programs; a shared program only steps down other
    // shared ones — never crosses that line in either direction.
    let deactivateQuery = supabase
      .from("programs")
      .update({ is_active: false })
      .eq("group_id", groupId)
      .neq("id", program.id);
    deactivateQuery = athleteId
      ? deactivateQuery.eq("athlete_id", athleteId)
      : deactivateQuery.is("athlete_id", null);
    await deactivateQuery;

    // The program page itself is the inline builder now — "+ Add Week"
    // right there creates the first day.
    router.push(`/groups/${groupId}/programs/${program.id}`);
  }

  return (
    <form onSubmit={handleSubmit} className="px-5 pt-6 space-y-4">
      <div>
        <label htmlFor="name" className="font-body text-xs text-steel uppercase tracking-wide">
          Program name
        </label>
        <input
          id="name"
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Strength Block 1"
          className="w-full h-11 mt-1 bg-surface border border-steel/30 text-chalk placeholder:text-steel/50 px-3 font-body focus:outline-none focus:border-rust"
        />
      </div>

      <div>
        <label
          htmlFor="description"
          className="font-body text-xs text-steel uppercase tracking-wide"
        >
          Description (optional)
        </label>
        <textarea
          id="description"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full mt-1 bg-surface border border-steel/30 text-chalk px-3 py-2 font-body focus:outline-none focus:border-rust resize-none"
        />
      </div>

      {error && (
        <p className="font-body text-sm text-rust" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full h-12 bg-rust text-graphite font-display uppercase text-lg font-bold disabled:opacity-40 active:bg-rust/80 transition-colors"
      >
        {submitting ? "Creating…" : "Continue"}
      </button>
    </form>
  );
}
