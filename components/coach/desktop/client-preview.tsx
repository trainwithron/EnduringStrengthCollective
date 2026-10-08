"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BuilderDemoThumb } from "@/components/coach/builder-demo-thumb";
import { builderDemoFor } from "@/lib/builder-demo";
import { summarizeSets } from "@/lib/exercise-summary";
import { renderNoteBody } from "@/lib/text-note-format";
import type { DemoRow } from "@/lib/exercise-demo";
import type { BuilderDay, BuilderExercise, BuilderNote } from "@/lib/types";
import { anotherModalIsOpen, releaseScrollLock } from "@/lib/modal-stack";

// "Preview as my client sees it": a read-only list of a day's (or a week's) exercises the way the client's workout page shows them: the name, what is prescribed (sets, reps, load, rest),
// the coach's note, and the demo picture that opens the same demo the client gets. It reads the builder's own state, so it shows what is on the screen right now, and it saves nothing.
export function ClientPreviewSheet({ days, heading, demoLibrary, onClose }: { days: BuilderDay[]; heading: string; demoLibrary: DemoRow[]; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    // With a demo open on top of this sheet, Esc is for the demo alone (it is the top dialog); this one closes only when it is the only dialog.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !anotherModalIsOpen()) onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      releaseScrollLock();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end sm:justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={heading}>
      <button type="button" aria-label="Close preview" onClick={onClose} className="absolute inset-0 bg-black/70" tabIndex={-1} />
      <div className="relative bg-graphite border border-steel/30 sm:rounded-2xl rounded-t-2xl w-full sm:max-w-xl max-h-[92vh] overflow-y-auto px-4 pt-3 pb-5">
        <div className="flex items-start justify-between gap-3 mb-1">
          <div className="min-w-0">
            <p className="font-body text-xs uppercase tracking-wide text-steel">Preview as your client sees it</p>
            <p className="font-display uppercase text-lg tracking-wide text-chalk break-words">{heading}</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className="shrink-0 h-11 px-5 rounded-full bg-surface border border-steel/40 font-body text-sm text-chalk active:border-rust">
            Close
          </button>
        </div>
        <p className="font-body text-xs text-steel mb-3">Read only. Nothing here is saved or sent.</p>
        {days.map((day) => (
          <PreviewDay key={day.id} day={day} showTitle={days.length > 1} demoLibrary={demoLibrary} />
        ))}
      </div>
    </div>
  );
}

function PreviewDay({ day, showTitle, demoLibrary }: { day: BuilderDay; showTitle: boolean; demoLibrary: DemoRow[] }) {
  const sorted = [...day.items].sort((a, b) => a.order - b.order);
  const exercises = sorted.filter((i): i is BuilderExercise => i.kind === "exercise");
  const notes = sorted.filter((i): i is BuilderNote => i.kind === "note" && i.body.trim() !== "");
  return (
    <section className="mb-4 last:mb-0">
      {showTitle && <h3 className="font-display uppercase text-sm tracking-wide text-steel mb-2">{day.title || `Day ${day.dayIndex + 1}`}</h3>}
      {notes.map((n) => (
        <div key={n.id} className="mb-3 p-3 border border-steel/20 bg-surface/40">
          <p className="font-body text-sm text-chalk whitespace-pre-wrap">{renderNoteBody(n.body)}</p>
        </div>
      ))}
      <h4 className="font-display uppercase text-xs tracking-wide text-steel mb-1">Prescribed</h4>
      {exercises.length === 0 ? (
        <p className="font-body text-sm text-steel py-3">No exercises on this day yet.</p>
      ) : (
        <div className="divide-y divide-steel/15">
          {exercises.map((ex) => (
            <PreviewRow key={ex.id} exercise={ex} demoLibrary={demoLibrary} />
          ))}
        </div>
      )}
    </section>
  );
}

function PreviewRow({ exercise, demoLibrary }: { exercise: BuilderExercise; demoLibrary: DemoRow[] }) {
  const demo = builderDemoFor(demoLibrary, exercise.exerciseName);
  return (
    <div className="py-3 flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <p className="font-body font-medium text-[15px] break-words">{exercise.exerciseName || "Exercise"}</p>
        <p className="font-body text-sm text-steel">{summarizeSets(exercise.sets, exercise.trackedFields, { withRest: true, withExtras: true })}</p>
        {exercise.notes && <p className="font-body text-xs text-steel mt-0.5 whitespace-pre-wrap">{exercise.notes}</p>}
      </div>
      {demo && <BuilderDemoThumb exerciseName={exercise.exerciseName} demo={demo} notes={exercise.notes} showCaption={false} />}
    </div>
  );
}

// The button that opens the preview for one day or a whole week.
export function ClientPreviewButton({ days, heading, label, demoLibrary }: { days: BuilderDay[]; heading: string; label: string; demoLibrary: DemoRow[] }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${label}: ${heading}`}
        className="font-body text-xs text-steel active:text-rust transition-colors shrink-0 min-h-11 sm:min-h-0 px-1"
      >
        {label}
      </button>
      {open && <ClientPreviewSheet days={days} heading={heading} demoLibrary={demoLibrary} onClose={close} />}
    </>
  );
}
