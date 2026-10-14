"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import type { CoachControl } from "@/lib/pr-promotion";

// On a record found in imported history: the coach asks the client to count it as a real one. The client gets one notification and a one-tap yes; on yes it behaves like any other record with its
// original date. After a not now the coach can ask again once 30 days have passed.
export function MakePrCountButton({ sessionId, exerciseName, control, clientName }: { sessionId: string; exerciseName: string; control: CoachControl; clientName: string }) {
  const router = useRouter();
  const [state, setState] = useState<CoachControl>(control);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { error: problem } = await createBrowserClient().rpc("ask_pr_promotion", { p_session: sessionId, p_exercise: exerciseName });
    setBusy(false);
    if (problem) {
      setError("Couldn't ask. Try again.");
      return;
    }
    setState({ kind: "waiting" });
    router.refresh();
  }

  if (state.kind === "counts") return null;
  if (state.kind === "waiting") return <span className="font-body text-xs text-steel">Asked {clientName}. Waiting for an answer.</span>;
  if (state.kind === "declined") return <span className="font-body text-xs text-steel">Said not now. You can ask again on {state.askAgainOn}.</span>;
  return (
    <>
      <button type="button" disabled={busy} onClick={() => void ask()} className="min-h-11 font-body text-xs text-rust underline underline-offset-2 disabled:opacity-40">
        {state.kind === "ask_again" ? "Ask again" : "Make this PR count"}
      </button>
      {error && (
        <span className="font-body text-xs text-rust" role="alert">
          {" "}
          {error}
        </span>
      )}
    </>
  );
}
