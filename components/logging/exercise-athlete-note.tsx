"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

// A place for an athlete to leave a note on this exact exercise instance ("shoulder felt off today"), separate from the heavier video-comment system
// (coach_dashboard_redesign_scoping.md's injury-keyword-flag prerequisite). It used to be a small "+ Add a note" link that was easy to miss; a beta client
// suggested a more prominent note section, so it is now a VISIBLE field: a labelled box that is always there while logging, two lines tall, saved when
// the athlete leaves it (the same blur-persist convention as components/coach/athlete-notes-editor.tsx). The text is 16 px so a phone does not zoom in on focus.
export function ExerciseAthleteNote({
  sessionExerciseId,
  initialNote,
  readOnly,
}: {
  sessionExerciseId: string;
  initialNote: string | null;
  readOnly: boolean;
}) {
  const [saved, setSaved] = useState(initialNote);
  const [draft, setDraft] = useState(initialNote ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function handleBlur() {
    const trimmed = draft.trim();
    if (trimmed === (saved ?? "")) return;
    setStatus("saving");
    const supabase = createBrowserClient();
    const { error } = await supabase
      .from("session_exercises")
      .update({ athlete_note: trimmed || null })
      .eq("id", sessionExerciseId);
    if (error) {
      setStatus("error");
      return;
    }
    setSaved(trimmed || null);
    setStatus("saved");
  }

  if (readOnly) {
    if (!saved) return null;
    return <p className="font-body text-xs text-steel mb-2 italic">Note: {saved}</p>;
  }

  const fieldId = `note-${sessionExerciseId}`;
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1">
        <label htmlFor={fieldId} className="font-body text-xs text-steel uppercase tracking-wide">
          Your notes
        </label>
        <span className="font-body text-xs text-steel" role="status" aria-live="polite">
          {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : status === "error" ? "Couldn't save, try again" : ""}
        </span>
      </div>
      <textarea
        id={fieldId}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          if (status !== "idle") setStatus("idle");
        }}
        onBlur={handleBlur}
        rows={2}
        maxLength={1000}
        placeholder="How did it feel? Anything your coach should know?"
        className="w-full min-h-[64px] bg-surface border border-steel/30 text-chalk px-3 py-2 font-body text-base focus:outline-none focus:border-rust resize-none"
      />
    </div>
  );
}
