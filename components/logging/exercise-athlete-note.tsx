"use client";

import { useEffect, useRef, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { createNoteAutosaver, type NoteAutosaver } from "@/lib/note-autosave";
import { clearNoteDraft, decideDraft, readNoteDraft, writeNoteDraft } from "@/lib/note-draft";
import { useSetSave } from "./set-save-context";

// A place to leave a note on this exact exercise ("shoulder felt off today"), separate from the heavier video-comment system
// (coach_dashboard_redesign_scoping.md's injury-keyword-flag prerequisite). It used to be a small "+ Add a note" link that was easy to miss; a beta client
// suggested a more prominent note section, so it is now a VISIBLE field: a labelled box that is always there while logging, two lines tall. A plain textarea
// (not an editable div), so the phone keyboard's microphone dictation works, and its text is 16 px so the phone does not zoom in on focus.
//
// Nothing typed or dictated is lost (lib/note-autosave.ts): it saves shortly after typing pauses, when the field loses focus (reading the value from the field
// itself), when the screen is left or the app is hidden, and Complete workout waits for it like it waits for the sets. A failed save shows Retry and tries
// again by itself. Text that never reached the server is kept on this phone (lib/note-draft.ts): restored silently when the server note is unchanged, offered
// ("Use it" / "Discard") when someone else changed the note meanwhile, dropped after a week and removed at sign-out.
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
  // (A kept draft is restored in the mount effect below, not here: reading storage while rendering would make the first client render differ from the server's HTML.)
  const [draft, setDraft] = useState(initialNote ?? "");
  const [staleDraft, setStaleDraft] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [savedNote, setSavedNote] = useState(initialNote);
  // The note the server holds (what a kept draft is typed over).
  const serverNoteRef = useRef(initialNote ?? "");
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
          serverNoteRef.current = trimmed ?? "";
          // Clear the kept draft only if it is exactly what was just saved: if the person kept typing while the save was in flight, the newer text stays.
          const kept = readNoteDraft(sessionExerciseId);
          if (kept && kept.text.trim() === (trimmed ?? "")) clearNoteDraft(sessionExerciseId);
          return true;
        }
        return false;
      },
      onStatus: (st) => setStatus(st),
    });
  }
  const saver = saverRef.current;

  // A draft kept on this phone: put back and saved if the server note is the one it was typed over, offered if the note changed since, dropped if identical.
  useEffect(() => {
    if (readOnly) return;
    const decision = decideDraft(readNoteDraft(sessionExerciseId), initialNote);
    if (decision.kind === "discard") clearNoteDraft(sessionExerciseId);
    else if (decision.kind === "restore") {
      setDraft(decision.text);
      saver.change(decision.text);
    } else if (decision.kind === "ask") setStaleDraft(decision.text);
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
      {staleDraft !== null && (
        <div className="mb-2 border border-steel/30 bg-surface/40 px-3 py-2" role="alert">
          <p className="font-body text-xs text-chalk">You have unsaved text from earlier on this phone, and this note has changed since.</p>
          <div className="flex gap-3 mt-1">
            <button
              type="button"
              onClick={() => {
                setDraft(staleDraft);
                writeNoteDraft(sessionExerciseId, serverNoteRef.current, staleDraft);
                saver.change(staleDraft);
                setStaleDraft(null);
              }}
              className="min-h-[44px] font-body text-xs text-rust"
            >
              Use it
            </button>
            <button
              type="button"
              onClick={() => {
                clearNoteDraft(sessionExerciseId);
                setStaleDraft(null);
              }}
              className="min-h-[44px] font-body text-xs text-steel"
            >
              Discard
            </button>
          </div>
        </div>
      )}
      <textarea
        id={fieldId}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          writeNoteDraft(sessionExerciseId, serverNoteRef.current, e.target.value);
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
