"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { addStarterLadders } from "@/lib/starter-ladders-add";

// "Add the starter ladders": a ladder for every movement pattern, easiest at the top, in the coach's own library. Only what is missing is added; nothing they have is changed.
export function AddStarterLaddersButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    setLine(null);
    const supabase = createBrowserClient();
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    const result = userId ? await addStarterLadders(supabase, userId) : { ok: false as const };
    setBusy(false);
    if (!result.ok) {
      setError("Couldn't add them. Try again.");
      return;
    }
    setLine(result.line);
    router.refresh();
  }

  return (
    <div className="mb-4">
      <button type="button" onClick={add} disabled={busy} className="min-h-11 px-4 border border-rust text-rust font-body text-sm font-medium disabled:opacity-40">
        {busy ? "Adding…" : "Add the starter ladders"}
      </button>
      <p className="font-body text-xs text-steel mt-1">Adds a ladder for each movement pattern, easiest at the top. Yours stay as they are.</p>
      {line && (
        <p className="font-body text-sm text-chalk mt-1" role="status">
          {line}
        </p>
      )}
      {error && (
        <p className="font-body text-xs text-rust mt-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
