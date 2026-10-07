"use client";

import { useEffect, useRef, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { createNoteAutosaver, type NoteAutosaver } from "@/lib/note-autosave";
import { useSetSave } from "./set-save-context";

// A place to leave a note on this exact exercise ("shoulder felt off today"), separate from the heavier video-comment system
// (coach_dashboard_redesign_scoping.md's injury-keyword-flag prerequisite). It used to be a small "+ Add a note" link that was easy to miss; a beta client
// suggested a more prominent note section, so it is now a VISIBLE field: a labelled box that is always there while logging, two lines tall. A plain textarea
// (not an editable div), so the phone keyboard's microphone dictation works, and its text is 16 px so the phone does not zoom in on focus.
//
// Nothing typed or dictated is lost (lib/note-autosave.ts): it saves shortly after typing pauses, when the field loses focus (reading the value from the field
// itself), when the screen is left or the app is hidden, and Complete workout waits for it like it waits for the sets. A failed save shows Retry and tries
// again by itself.
function readDraft(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeDraft(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // storage blocked: the autosave still works
  }
}
function clearDraft(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // nothing to clear
  }
}

export function ExerciseAthleteNote({
  sessionExerciseId,
  initialNote,
  readOnly,
  ownNote = true,
}: {
  sessionExerciseId: string;
  initialNote: string | null;
  readOnly: boolean;
  // False when a coach is typing in a client's session (the note is stored as the exercise's note, the label says whose it is).
  ownNote?: boolean;
}) {
  // A draft that never reached the server (a failed last save, the app killed) is kept on this phone and restored, so typed or dictated text is never lost.
  const draftKey = `note-draft:${sessionExerciseId}`;
  // (Restored in the mount effect below, not here: reading storage while rendering would make the first client render differ from the server's HTML.)
  const [draft, setDraft] = useState(initialNote ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [savedNote, setSavedNote] = useState(initialNote);
  const { registerPending } = useSetSave();
  const saverRef = useRef<NoteAutosaver | null>(null);
  if (!saverRef.current) {
    saverRef.current = createNoteAutosaver({
      initial: initialNote,
      write: async (trimmed) => {
        const supabase = createBrowserClient();
        // A zero-row update (a rule refused it) is a failure, not a success.
        const { data, error } = await supabase.from("session_exercises").update({ athlete_note: trimmed }).eq("id", sessionExerciseId).select("id");
        if (!error && Array.isArray(data) && data.length === 1) {
          setSavedNote(trimmed);
          // Clear the kept draft only if it is exactly what was just saved: if the person kept typing while the save was in flight, the newer text stays.
          if ((readDraft(draftKey) ?? "").trim() === (trimmed ?? "")) clearDraft(draftKey);
          return true;
        }
        return false;
      },
      onStatus: (st) => setStatus(st),
    });
  }
  const saver = saverRef.current;

  // A draft kept on this phone that differs from what the server has is put back in the field and saved right away.
  useEffect(() => {
    if (readOnly) return;
    const stored = readDraft(draftKey);
    if (stored != null && stored.trim() !== (initialNote ?? "").trim()) {
      setDraft(stored);
      saver.change(stored);
    }
    // only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Complete workout waits for a pending note; leaving the screen or hiding the app saves it; the connection coming back retries it.
  useEffect(() => {
    if (readOnly) return;
    saver.reopen();
    const unregister = registerPending(() => saver.flush());
    const onHide = () => {
      if (document.visibilityState === "hidden") void saver.flush();
    };
    const onPageHide = () => void saver.flush();
    const onOnline = () => {
      if (saver.isDirty()) void saver.retry();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("online", onOnline);
    return () => {
      unregister();
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("online", onOnline);
      // Leaving this card or screen with unsaved text: save it now (a flush still works after dispose; it just stops reporting status).
      void saver.flush();
      saver.dispose();
    };
  }, [readOnly, registerPending, saver]);

  if (readOnly) {
    if (!savedNote) return null;
    return <p className="font-body text-xs text-steel mb-2 italic">Note: {savedNote}</p>;
  }

  const fieldId = `note-${sessionExerciseId}`;
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between min-h-[24px] mb-1">
        <label htmlFor={fieldId} className="font-body text-xs text-steel uppercase tracking-wide">
          {ownNote ? "Your notes" : "Notes for this exercise"}
        </label>
        {status === "error" ? (
          <button type="button" onClick={() => void saver.retry()} className="min-h-[44px] -my-2 px-2 font-body text-xs text-rust">
            Couldn&apos;t save. Retry
          </button>
        ) : (
          <span className="font-body text-xs text-steel" role="status" aria-live="polite">
            {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : ""}
          </span>
        )}
      </div>
      <textarea
        id={fieldId}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          writeDraft(draftKey, e.target.value);
          saver.change(e.target.value);
        }}
        onBlur={(e) => void saver.flush(e.currentTarget.value)}
        rows={2}
        maxLength={2000}
        placeholder="How did it feel? Anything your coach should know?"
        className="w-full min-h-[64px] bg-surface border border-steel/30 text-chalk px-3 py-2 font-body text-base focus:outline-none focus:border-rust resize-none"
      />
    </div>
  );
}
