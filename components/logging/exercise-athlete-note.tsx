"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

// coach_dashboard_redesign_scoping.md's injury-keyword-flag prerequisite
// — a plain, low-friction place for an athlete to leave a note on this
// exact exercise instance ("shoulder felt off today"), separate from the
// heavier video-comment system. Collapsed by default (most exercises get
// no note at all) so it never adds visual weight to normal logging;
// blur-persist, same immediate-save convention as
// components/coach/athlete-notes-editor.tsx.
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialNote ?? "");
  const [saving, setSaving] = useState(false);

  async function handleBlur() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed === (saved ?? "")) return;
    setSaving(true);
    const supabase = createBrowserClient();
    const { error } = await supabase
      .from("session_exercises")
      .update({ athlete_note: trimmed || null })
      .eq("id", sessionExerciseId);
    setSaving(false);
    if (!error) setSaved(trimmed || null);
  }

  if (readOnly) {
    if (!saved) return null;
    return <p className="font-body text-xs text-steel mb-2 italic">Note: {saved}</p>;
  }

  if (editing) {
    return (
      <div className="mb-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={handleBlur}
          autoFocus
          rows={2}
          placeholder="Anything worth noting on this exercise today?"
          className="w-full bg-surface border border-steel/30 text-chalk px-2 py-1.5 font-body text-xs focus:outline-none focus:border-rust resize-none"
        />
        {saving && <p className="font-body text-[11px] text-steel mt-1">Saving…</p>}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(saved ?? "");
        setEditing(true);
      }}
      className="font-body text-xs text-steel active:text-rust transition-colors mb-2 block"
    >
      {saved ? `Note: ${saved}` : "+ Add a note"}
    </button>
  );
}
