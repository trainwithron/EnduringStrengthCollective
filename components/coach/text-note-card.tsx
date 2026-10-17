"use client";

import { useRef, useState } from "react";
import { useSaveToastChannel } from "./desktop/save-toast-channel";
import { restoreNote } from "@/lib/program-restore";
import { showUndo } from "@/lib/undo-toast";
import { createBrowserClient } from "@/lib/supabase/client";
import { insertNoteSyntax, renderNoteBody } from "@/lib/text-note-format";
import { Bold, ChevronDown, ChevronUp, Italic, Link as LinkIcon, Trash2 } from "lucide-react";

export function TextNoteCard({
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
  // Tells the day what the note now says once it is saved, so the day's copy never goes stale (a reorder or a re-draw would show the old words).
  onBodyChange?: (body: string) => void;
  onRestored?: (note: { kind: "note"; id: string; order: number; body: string }) => void;
}) {
  const { flashSaved, flashSaveError } = useSaveToastChannel();
  const lastSaved = useRef(initialBody);
  const [body, setBody] = useState(initialBody);
  const [editing, setEditing] = useState(initialBody.trim().length === 0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function persist(nextBody: string) {
    const supabase = createBrowserClient();
    const { error } = await supabase
      .from("workout_notes")
      .update({ body: nextBody, updated_at: new Date().toISOString() })
      .eq("id", noteId);
    if (error) {
      flashSaveError("Couldn't save that note — try again.");
      return;
    }
    lastSaved.current = nextBody;
    onBodyChange?.(nextBody);
    flashSaved();
  }

  function applyFormat(kind: "bold" | "italic" | "link") {
    const el = textareaRef.current;
    if (!el) return;
    const result = insertNoteSyntax(body, el.selectionStart, el.selectionEnd, kind);
    setBody(result.value);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(result.selectionStart, result.selectionEnd);
    });
  }

  async function handleDelete() {
    const supabase = createBrowserClient();
    const { error } = await supabase.from("workout_notes").delete().eq("id", noteId);
    if (error) {
      flashSaveError("Couldn't delete that note — try again.");
      return;
    }
    onDeleted();
    const gone = { kind: "note" as const, id: noteId, order, body: lastSaved.current };
    showUndo({
      message: "Deleted the note.",
      onUndo: async () => {
        const back = await restoreNote(createBrowserClient(), { groupId, workoutId, note: gone });
        if (back) onRestored?.(back);
        else flashSaveError("Couldn't put that note back — add it again.");
      },
    });
  }

  return (
    <div className="border border-steel/20 p-3 bg-surface/40">
      <div className="flex items-center justify-between mb-2">
        <span className="font-body text-xs text-steel uppercase tracking-wide">
          Text note
        </span>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5" aria-label="Reorder note">
            <button
              type="button"
              onClick={onMoveUp}
              disabled={!canMoveUp}
              aria-label="Move note up"
              className="w-11 h-11 sm:w-8 sm:h-8 flex items-center justify-center text-steel disabled:opacity-30"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onMoveDown}
              disabled={!canMoveDown}
              aria-label="Move note down"
              className="w-11 h-11 sm:w-8 sm:h-8 flex items-center justify-center text-steel disabled:opacity-30"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>
          {!editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="font-body text-xs text-steel active:text-rust transition-colors"
            >
              Edit
            </button>
          )}
          <button
            type="button"
            onClick={handleDelete}
            aria-label="Delete note"
            className="text-steel active:text-rust transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {editing ? (
        <div>
          <div className="flex items-center gap-1 mb-1.5">
            <button
              type="button"
              // Prevent the textarea from blurring on click so the ref
              // stays valid and focus returns correctly after inserting.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyFormat("bold")}
              aria-label="Bold"
              className="w-7 h-7 flex items-center justify-center text-steel border border-steel/30 active:border-rust active:text-rust"
            >
              <Bold className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyFormat("italic")}
              aria-label="Italic"
              className="w-7 h-7 flex items-center justify-center text-steel border border-steel/30 active:border-rust active:text-rust"
            >
              <Italic className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyFormat("link")}
              aria-label="Link"
              className="w-7 h-7 flex items-center justify-center text-steel border border-steel/30 active:border-rust active:text-rust"
            >
              <LinkIcon className="w-3.5 h-3.5" />
            </button>
          </div>
          <textarea
            ref={textareaRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onBlur={() => {
              if (body !== lastSaved.current) persist(body);
              setEditing(false);
            }}
            rows={4}
            autoFocus
            placeholder="Coaching note for this day…"
            className="w-full bg-graphite border border-steel/30 text-chalk px-2 py-1.5 font-body text-sm focus:outline-none focus:border-rust resize-none"
          />
        </div>
      ) : (
        <p
          onClick={() => setEditing(true)}
          className="font-body text-sm text-chalk whitespace-pre-wrap cursor-text"
        >
          {renderNoteBody(body)}
        </p>
      )}
    </div>
  );
}
