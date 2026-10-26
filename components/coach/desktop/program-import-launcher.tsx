"use client";

import { useEffect, useRef, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { confirmDialog } from "@/components/shared/confirm-dialog";
import { ImportWizard } from "@/components/coach/desktop/import-wizard";

// What the wizard accepts: a spreadsheet, a PDF, a photo, or a text file.
export const IMPORT_FILE_ACCEPT = ".csv,.tsv,.xlsx,.xls,.pdf,.txt,.md,image/*";
export const LEAVE_IMPORT_MESSAGE = "Leave this import? Nothing has been created yet; what you have here will be lost.";

interface Loaded {
  coachId: string;
  library: { name: string }[];
  aliases: { rawName: string; exerciseName: string }[];
}

// The program import, on the page you are already on. "Import program" opens the computer's own file picker; the chosen file then runs through the same import (reading, matching exercises to the
// library, the review, creating the program) in a large panel over this page. Cancelling the picker does nothing. Nothing is created until the review is finished, so closing the panel loses nothing that exists; closing while something is in progress asks first.
export function ProgramImportLauncher({
  groupId,
  athleteId = null,
  tone = "link",
  orgProgram = false,
}: {
  groupId: string;
  athleteId?: string | null;
  tone?: "link" | "button";
  orgProgram?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [panel, setPanel] = useState<{ file: File } | null>(null);

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <input
          ref={fileRef}
          type="file"
          accept={IMPORT_FILE_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose a program file to import"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) setPanel({ file });
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className={
            tone === "button"
              ? "min-h-11 px-4 border border-rust text-rust font-body text-sm font-medium"
              : "min-h-11 inline-flex items-center font-body text-sm text-rust font-medium underline underline-offset-2"
          }
        >
          Import program
        </button>
      </div>
      {panel && <ProgramImportPanel groupId={groupId} athleteId={athleteId} orgProgram={orgProgram} file={panel.file} onClose={() => setPanel(null)} />}
    </>
  );
}

// The large panel with the import in it, over the page you are on. Started on a chosen file, or on program text pasted into the AI builder box.
export function ProgramImportPanel({
  groupId,
  athleteId,
  file = null,
  text = null,
  onClose,
  orgProgram = false,
}: {
  groupId: string;
  athleteId: string | null;
  orgProgram?: boolean;
  file?: File | null;
  text?: string | null;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const activeRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = createBrowserClient();
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        if (!cancelled) setFailed(true);
        return;
      }
      const [{ data: library }, { data: aliasRows }] = await Promise.all([
        supabase.from("exercise_library").select("name").eq("created_by", userData.user.id).order("name"),
        supabase.from("exercise_aliases").select("raw_name, exercise_name").eq("coach_id", userData.user.id),
      ]);
      if (cancelled) return;
      setLoaded({
        coachId: userData.user.id,
        library: (library ?? []).map((r) => ({ name: r.name as string })),
        aliases: (aliasRows ?? []).map((a) => ({ rawName: a.raw_name as string, exerciseName: a.exercise_name as string })),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function close() {
    if (activeRef.current && !(await confirmDialog({ message: LEAVE_IMPORT_MESSAGE, confirmLabel: "Leave", destructive: true }))) return;
    onClose();
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Import program">
      <button type="button" aria-label="Close" tabIndex={-1} onClick={() => void close()} className="hidden md:block flex-1 bg-black/60" />
      <div className="w-full md:w-3/4 h-full overflow-y-auto bg-graphite border-l border-steel/20 p-4 md:p-6">
        <div className="flex items-center justify-between gap-3 pb-3 mb-4 border-b border-steel/20">
          <h2 className="font-display font-bold text-xl uppercase">Import program</h2>
          <button type="button" onClick={() => void close()} className="min-h-11 px-3 font-body text-sm text-steel hover:text-chalk">
            Close
          </button>
        </div>
        {failed ? (
          <p className="font-body text-sm text-rust" role="alert">
            Couldn&apos;t open the import. Close this and try again.
          </p>
        ) : !loaded ? (
          <p className="font-body text-sm text-steel" role="status">
            Loading…
          </p>
        ) : (
          <ImportWizard
            coachId={loaded.coachId}
            groupId={groupId}
            athleteId={athleteId}
            initialLibrary={loaded.library}
            initialAliases={loaded.aliases}
            initialFile={file}
            initialText={text}
            orgProgram={orgProgram}
            onActivity={(active) => {
              activeRef.current = active;
            }}
          />
        )}
      </div>
    </div>
  );
}
