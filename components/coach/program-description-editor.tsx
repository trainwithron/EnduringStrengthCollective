"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { saved } from "@/lib/saved";
import { PROGRAM_DESCRIPTION_MAX, descriptionCounter, tidyProgramDescription } from "@/lib/program-description";

// The program's description, editable after the fact for any program (one the AI wrote or one the coach built). It shows the text with an "Edit description" link; editing opens a box with a counter and a plain Save.
// "Saved" is shown only when the write really saved (lib/saved.ts); a failed save keeps the box open with what was typed.
export function ProgramDescriptionEditor({ programId, initialDescription }: { programId: string; initialDescription: string | null }) {
  const [current, setCurrent] = useState<string | null>(initialDescription);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(initialDescription ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "saved" | "failed"; text: string } | null>(null);

  async function save() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const next = tidyProgramDescription(text);
    const supabase = createBrowserClient();
    const ok = await saved(supabase.from("programs").update({ description: next }).eq("id", programId), "Couldn't save the description.");
    setBusy(false);
    if (!ok) {
      setMessage({ kind: "failed", text: "Didn't save. What you typed is still here; try again." });
      return;
    }
    setCurrent(next);
    setText(next ?? "");
    setEditing(false);
    setMessage({ kind: "saved", text: "Saved." });
  }

  if (!editing) {
    return (
      <div className="mt-2 max-w-[70ch]">
        {current && <p className="font-body text-sm text-steel whitespace-pre-line">{current}</p>}
        <button
          type="button"
          onClick={() => {
            setText(current ?? "");
            setMessage(null);
            setEditing(true);
          }}
          className="font-body text-xs text-rust underline underline-offset-2 min-h-8"
        >
          {current ? "Edit description" : "Add a description"}
        </button>
        {message?.kind === "saved" && (
          <span className="font-body text-xs text-steel ml-3" role="status">
            {message.text}
          </span>
        )}
      </div>
    );
  }

  const counter = descriptionCounter(text);
  return (
    <div className="mt-2 max-w-[70ch]">
      <label className="block">
        <span className="font-body text-xs text-steel uppercase tracking-wide">Description</span>
        <textarea
          value={text}
          maxLength={PROGRAM_DESCRIPTION_MAX}
          rows={4}
          onChange={(e) => setText(e.target.value)}
          className="mt-1 w-full bg-graphite border border-steel/40 text-chalk px-2 py-2 font-body text-base sm:text-sm focus:outline-none focus:border-rust"
        />
      </label>
      <div className="flex items-center justify-between gap-3 mt-1">
        <span className={`font-body text-xs ${counter.nearLimit ? "text-rust" : "text-steel"}`}>{counter.label}</span>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setText("")} disabled={busy || text === ""} className="font-body text-xs text-steel underline underline-offset-2 disabled:opacity-40 min-h-8">
            Clear
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setMessage(null);
            }}
            disabled={busy}
            className="font-body text-xs text-steel underline underline-offset-2 min-h-8"
          >
            Cancel
          </button>
          <button type="button" onClick={() => void save()} disabled={busy} className="h-9 px-4 bg-rust text-graphite font-display uppercase text-sm font-bold disabled:opacity-40">
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      {message?.kind === "failed" && (
        <p className="font-body text-xs text-rust mt-1" role="alert">
          {message.text}
        </p>
      )}
    </div>
  );
}
