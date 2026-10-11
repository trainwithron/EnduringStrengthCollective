"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { confirmDialog } from "@/components/shared/confirm-dialog";

// Signing off an AI-built program: ONE update clears the draft flag and makes it active (done by /api/ai/sign-off, which also quietly notes what the coach changed). Until then it is
// not live and no client sees it (the database refuses to make a draft active any other way). Used on the program page and on the program's card.
// activate: false approves the draft WITHOUT making the original active (used when approving in order to assign a copy to a client).
export async function signOffProgram(programId: string, options: { activate?: boolean } = {}): Promise<boolean> {
  try {
    const res = await fetch("/api/ai/sign-off", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(options.activate === false ? { programId, activate: false } : { programId }) });
    return res.ok;
  } catch {
    return false;
  }
}

export function AiDraftBanner({ programId, programName }: { programId: string; programName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOff() {
    if (busy) return;
    if (!(await confirmDialog({ message: `Sign off "${programName}" and make it active? Clients it is assigned to will see it.`, confirmLabel: "Sign off" }))) return;
    setBusy(true);
    setError(null);
    const ok = await signOffProgram(programId);
    setBusy(false);
    if (!ok) {
      setError("That didn't save. The program is still a draft.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="mb-4 border border-rust/50 bg-rust/5 p-3 flex flex-wrap items-center justify-between gap-3" role="status">
      <p className="font-body text-sm text-chalk max-w-[60ch]">
        <span className="font-medium text-rust">AI draft.</span> Nothing reaches a client until you sign off. Check it, change anything you like, then sign off.
      </p>
      <div className="flex items-center gap-3">
        {error && (
          <span className="font-body text-xs text-rust" role="alert">
            {error}
          </span>
        )}
        <button type="button" onClick={signOff} disabled={busy} className="min-h-11 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
          {busy ? "Saving…" : "Sign off and make active"}
        </button>
      </div>
    </div>
  );
}
