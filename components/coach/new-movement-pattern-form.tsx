"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

const PLANES = ["sagittal", "frontal", "transverse"] as const;

export function NewMovementPatternForm() {
  const [name, setName] = useState("");
  const [plane, setPlane] = useState<(typeof PLANES)[number] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    setSubmitting(true);
    setError(null);
    const supabase = createBrowserClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setSubmitting(false);
      return;
    }

    const { error: insertError } = await supabase
      .from("movement_patterns")
      .insert({ created_by: userData.user.id, name: trimmed, plane });

    if (insertError) {
      setError(insertError.message);
      setSubmitting(false);
      return;
    }

    setName("");
    setPlane(null);
    setSubmitting(false);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Horizontal Push"
          className="flex-1 h-10 bg-surface border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
        />
        <button
          type="submit"
          disabled={submitting}
          className="h-10 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
        >
          {submitting ? "Adding…" : "Add"}
        </button>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="font-body text-xs text-steel uppercase tracking-wide mr-1">Plane</span>
        {PLANES.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPlane((prev) => (prev === p ? null : p))}
            className={`h-7 px-2.5 border font-body text-xs capitalize transition-colors ${
              plane === p
                ? "bg-rust border-rust text-graphite"
                : "border-steel/30 text-steel active:border-rust active:text-rust"
            }`}
          >
            {p}
          </button>
        ))}
      </div>
      {error && <p className="font-body text-xs text-rust">{error}</p>}
    </form>
  );
}
