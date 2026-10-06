"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import Link from "next/link";
import { detectTrainingIntent } from "@/lib/training-intent";
import { clientNameInProgramName, type NamedClient } from "@/lib/program-client-name";

export function NewProgramForm({
  groupId,
  createdBy,
  athleteId,
  groupName,
  sharedGroup,
  soloClients,
}: {
  groupId: string;
  createdBy: string;
  groupName: string;
  // True for a team or social group: a program made here (not for one person) is visible to everyone in it.
  sharedGroup: boolean;
  soloClients: NamedClient[];
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
  const [shareAnyway, setShareAnyway] = useState(false);
  const router = useRouter();
  const namedClient = sharedGroup && !athleteId ? clientNameInProgramName(name, soloClients) : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    if (namedClient && !shareAnyway) {
      setError(`This looks like ${namedClient.fullName}'s program. Build it in their own space, or tick the box to share it with everyone in ${groupName}.`);
      return;
    }

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

    // A coach can run several programs for one client at once (main work,
    // mobility, a warm-up flow), so creating a program never deactivates
    // another — activation is per program.

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

      {namedClient && (
        <div className="border border-yellow-500/40 bg-yellow-500/5 p-3" role="note">
          <p className="font-body text-sm text-chalk">
            That looks like {namedClient.fullName}&apos;s name. A program made here is shared with everyone in {groupName}, so they
            would see it.
          </p>
          <Link href={`/groups/${namedClient.groupId}/programs/new`} className="inline-block mt-2 font-body text-sm text-rust underline">
            Build it in {namedClient.fullName}&apos;s own space instead
          </Link>
          <label className="flex items-start gap-2 mt-3 font-body text-xs text-steel cursor-pointer">
            <input type="checkbox" checked={shareAnyway} onChange={(e) => setShareAnyway(e.target.checked)} className="mt-0.5 w-4 h-4 accent-rust" />
            I mean to share this with everyone in {groupName}
          </label>
        </div>
      )}

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
