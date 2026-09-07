"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

export function NewProgramForm({
  groupId,
  createdBy,
}: {
  groupId: string;
  createdBy: string;
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
      })
      .select("id")
      .single();

    if (insertError || !program) {
      setError(insertError?.message ?? "Couldn't create the program.");
      setSubmitting(false);
      return;
    }

    // Only one program is ever "active" per group — a new program defaults
    // to active (its own column default), so every other program in the
    // group needs to step down in the same action.
    await supabase
      .from("programs")
      .update({ is_active: false })
      .eq("group_id", groupId)
      .neq("id", program.id);

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
          className="w-full h-11 mt-1 bg-surface border border-steel/30 text-chalk px-3 font-body focus:outline-none focus:border-rust"
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
