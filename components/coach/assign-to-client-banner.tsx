"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { assignProgramToClient, isImportRefusal } from "@/lib/program-duplication";

// A program started from a client's page belongs to the coach until they assign it. While it is nobody's, one line says so and one button gives that client their own copy (the same
// assign the client's profile uses; the program stays in the coach's list). Shown only while the program has no client and the client came from the address of a page the coach built it from.
export function AssignToClientBanner({
  programId,
  clientId,
  clientGroupId,
  firstName,
  alreadyAssigned,
  aiDraft,
}: {
  programId: string;
  clientId: string;
  clientGroupId: string;
  firstName: string;
  alreadyAssigned: boolean;
  aiDraft: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(alreadyAssigned);
  const [error, setError] = useState<string | null>(null);

  async function assign() {
    setBusy(true);
    setError(null);
    const result = await assignProgramToClient(createBrowserClient(), { sourceProgramId: programId, destinationGroupId: clientGroupId, athleteId: clientId });
    setBusy(false);
    if ("error" in result) {
      setError(isImportRefusal(result.error) ? result.error : "Couldn't assign it. Try again.");
      return;
    }
    setDone(true);
    router.refresh();
  }

  return (
    <div className="mb-4 border border-steel/25 bg-surface/40 p-3 flex flex-wrap items-center gap-3" role="region" aria-label={`Assign to ${firstName}`}>
      {done ? (
        <p className="font-body text-sm text-positive" role="status">
          Assigned to {firstName}.
        </p>
      ) : (
        <>
          <p className="font-body text-sm text-steel">
            Not assigned yet. {firstName} can&apos;t see this.
            {aiDraft && " Sign it off first."}
          </p>
          <button
            type="button"
            onClick={assign}
            disabled={busy || aiDraft}
            className="inline-flex items-center justify-center min-h-11 px-4 font-body text-sm bg-rust text-graphite disabled:opacity-50"
          >
            {busy ? "Assigning…" : `Assign to ${firstName}`}
          </button>
        </>
      )}
      {error && (
        <p className="font-body text-sm text-rust w-full" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
