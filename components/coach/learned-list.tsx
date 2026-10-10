"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

export interface LearnedLine {
  // A learned rule (undo) or a preference the coach saved in the program chat (remove).
  kind: "rule" | "preference";
  id: string;
  text: string;
  evidence: string | null;
  reason: string | null;
}

// "What I've learned about how you coach": one plain list of everything the builder has been told to do your way (from your edits you said Yes to, and from the program chat), each
// with one tap to take it out; a plain on/off for being asked questions; and one honest line about how it is going. Private to the coach.
export function LearnedList({
  lines,
  questionsEnabled,
  coachId,
  askingLess,
}: {
  lines: LearnedLine[];
  questionsEnabled: boolean;
  coachId: string;
  askingLess: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(questionsEnabled);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  async function remove(line: LearnedLine) {
    setError(null);
    let ok = true;
    if (line.kind === "rule") {
      const res = await fetch(`/api/learned-rules/${line.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "undo" }) }).catch(() => null);
      ok = !!res?.ok;
    } else {
      const { error: e } = await createBrowserClient().from("coach_program_preferences").delete().eq("id", line.id);
      ok = !e;
    }
    if (!ok) {
      setError("That didn't work. Nothing was changed.");
      return;
    }
    setGone((g) => new Set(g).add(line.kind + line.id));
    router.refresh();
  }

  async function toggle(next: boolean) {
    setEnabled(next);
    const { error: e } = await createBrowserClient().from("coach_learning_settings").upsert({ coach_id: coachId, questions_enabled: next, updated_at: new Date().toISOString() });
    if (e) {
      setEnabled(!next);
      setError("That didn't save.");
    }
  }

  const shown = lines.filter((l) => !gone.has(l.kind + l.id));
  return (
    <section className="mt-10 border-t border-steel/20 pt-6 max-w-2xl" aria-label="What I've learned about how you coach">
      <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-1">What I&apos;ve learned about how you coach</h2>
      <p className="font-body text-xs text-steel mb-3">
        {shown.length === 0
          ? "Nothing yet. As you change what the AI builds, I'll notice and ask once."
          : `I've learned ${shown.length} ${shown.length === 1 ? "thing" : "things"}${askingLess ? ", so I'm asking less" : ""}.`}
      </p>
      {shown.length > 0 && (
        <ul className="divide-y divide-steel/15 border border-steel/20">
          {shown.map((l) => (
            <li key={l.kind + l.id} className="flex items-start gap-3 px-3 py-2">
              <div className="flex-1 min-w-0">
                <p className="font-body text-sm text-chalk">{l.text}</p>
                {l.evidence && <p className="font-body text-xs text-steel">{l.evidence}</p>}
                {l.reason && <p className="font-body text-xs text-steel">Your reason: {l.reason}</p>}
              </div>
              <button type="button" onClick={() => remove(l)} className="min-h-11 px-2 font-body text-xs text-steel underline shrink-0">
                {l.kind === "rule" ? "Undo" : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="mt-3 flex items-center gap-2 font-body text-sm text-chalk min-h-11">
        <input type="checkbox" checked={enabled} onChange={(e) => toggle(e.target.checked)} />
        Ask me about changes I make
      </label>
      <p className="font-body text-xs text-steel">Off: I still notice, but I won&apos;t ask. The AI builder gives less tailored results if I don&apos;t learn from you.</p>
      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
