"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { checkProgramName, PROGRAM_NAME_MAX } from "@/lib/program-name";

// Rename one program in place. Enter or leaving the field saves, Escape cancels. It changes the name of THIS program only (never the template it came from, other copies or any history).
// Row security matches nothing, without an error, when the person may not change the program, so an update that touched no row is shown as a failure.
export function ProgramNameInput({ programId, initial, onDone, className = "" }: { programId: string; initial: string; onDone: (saved: string | null) => void; className?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const finished = useRef(false);

  async function save() {
    if (finished.current || busy) return;
    const checked = checkProgramName(value);
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    if (checked.name === initial) {
      finished.current = true;
      onDone(null);
      return;
    }
    setBusy(true);
    setError(null);
    const { data, error: updateError } = await createBrowserClient().from("programs").update({ name: checked.name }).eq("id", programId).select("id");
    setBusy(false);
    if (updateError || !data || data.length === 0) {
      setError("Couldn't rename it");
      return;
    }
    finished.current = true;
    onDone(checked.name);
    router.refresh();
  }

  function cancel() {
    finished.current = true;
    onDone(null);
  }

  return (
    <div className={className}>
      <input
        autoFocus
        value={value}
        maxLength={PROGRAM_NAME_MAX + 20}
        disabled={busy}
        aria-label="Program name"
        aria-invalid={!!error}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void save();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        onBlur={() => void save()}
        onFocus={(e) => e.currentTarget.select()}
        className="w-full min-h-11 bg-graphite border border-steel/40 text-chalk px-2 font-body text-base sm:text-sm focus:outline-none focus:border-rust"
      />
      {error && (
        <p className="font-body text-xs text-rust mt-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
