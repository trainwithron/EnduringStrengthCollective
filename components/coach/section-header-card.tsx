"use client";

import { useRef, useState } from "react";
import { useSaveToastChannel } from "./desktop/save-toast-channel";
import { restoreNote } from "@/lib/program-restore";
import { showUndo } from "@/lib/undo-toast";
import { createBrowserClient } from "@/lib/supabase/client";
import { SECTION_HEADER_MAX, sectionHeaderProblem } from "@/lib/section-headers";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";

// A section header between exercises in the builder (B3): one line of words, saved when the coach leaves the box. Moved, renamed and deleted (with Undo) like a note.
export function SectionHeaderCard({
  noteId,
  workoutId,
  groupId,
  order,
  initialBody,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onDeleted,
  onRestored,
  onBodyChange,
}: {
  noteId: string;
  workoutId: string;
  groupId: string;
  order: number;
  initialBody: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDeleted: () => void;
  onRestored?: (note: { kind: "note"; id: string; order: number; body: string; header?: boolean }) => void;
  onBodyChange?: (body: string) => void;
}) {
  const { flashSaved, flashSaveError } = useSaveToastChannel();
  const lastSaved = useRef(initialBody);
  const [body, setBody] = useState(initialBody);
  const [problem, setProblem] = useState<string | null>(null);

  async function persist() {
    const next = body.trim();
    if (next === lastSaved.current) return;
    const p = sectionHeaderProblem(next);
    if (p) {
      setProblem(p);
      return;
    }
    setProblem(null);
    const { error } = await createBrowserClient().from("workout_notes").update({ body: next, updated_at: new Date().toISOString() }).eq("id", noteId);
    if (error) {
      flashSaveError("Couldn't save that header. Try again.");
      return;
    }
    lastSaved.current = next;
    setBody(next);
    onBodyChange?.(next);
    flashSaved();
  }

  async function handleDelete() {
    const { error } = await createBrowserClient().from("workout_notes").delete().eq("id", noteId);
    if (error) {
      flashSaveError("Couldn't delete that header. Try again.");
      return;
    }
    onDeleted();
    const gone = { kind: "note" as const, id: noteId, order, body: lastSaved.current, header: true };
    showUndo({
      message: "Deleted the header.",
      onUndo: async () => {
        const back = await restoreNote(createBrowserClient(), { groupId, workoutId, note: gone });
        if (back) onRestored?.(back);
        else flashSaveError("Couldn't put that header back. Add it again.");
      },
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b-2 border-rust/60 pb-1 pt-2" data-section-header>
      <label className="sr-only" htmlFor={`section-header-${noteId}`}>
        Section header
      </label>
      <input
        id={`section-header-${noteId}`}
        type="text"
        value={body}
        maxLength={SECTION_HEADER_MAX}
        placeholder="Section header, e.g. Warm-up"
        autoFocus={initialBody.trim().length === 0}
        onChange={(e) => setBody(e.target.value)}
        onBlur={() => void persist()}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        aria-invalid={problem ? true : undefined}
        className="flex-1 min-w-0 h-10 bg-transparent font-display uppercase tracking-wide text-base text-chalk placeholder:text-steel placeholder:normal-case focus:outline-none focus-visible:ring-2 focus-visible:ring-rust px-1"
      />
      <div className="flex items-center gap-0.5" aria-label="Reorder header">
        <button type="button" onClick={onMoveUp} disabled={!canMoveUp} aria-label="Move header up" className="w-11 h-11 sm:w-8 sm:h-8 flex items-center justify-center text-steel disabled:opacity-30">
          <ChevronUp className="w-3.5 h-3.5" />
        </button>
        <button type="button" onClick={onMoveDown} disabled={!canMoveDown} aria-label="Move header down" className="w-11 h-11 sm:w-8 sm:h-8 flex items-center justify-center text-steel disabled:opacity-30">
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>
      <button type="button" onClick={() => void handleDelete()} aria-label="Delete header" className="w-11 h-11 sm:w-8 sm:h-8 flex items-center justify-center text-steel active:text-rust-ink">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
      {problem && (
        <p className="basis-full font-body text-xs text-rust-ink" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
