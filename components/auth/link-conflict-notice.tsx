"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { establishSessionFromLink } from "@/lib/auth-link-client";

// Shown when someone follows an email link while ALREADY signed in as a different account. The link never replaces who is signed in without asking (a link could
// have been sent by somebody else); the person picks.
export function LinkConflictNotice({ currentEmail }: { currentEmail: string }) {
  const [busy, setBusy] = useState(false);

  async function useTheLink() {
    setBusy(true);
    await establishSessionFromLink(createBrowserClient(), { replace: true });
    window.location.reload();
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 text-center">
      <div className="max-w-sm">
        <h1 className="font-display uppercase text-2xl font-bold">This link is for a different account</h1>
        <p className="font-body text-steel text-sm mt-2">
          You are signed in as {currentEmail}. The link you opened is for another account. Only continue if you asked for this link yourself.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <button type="button" onClick={useTheLink} disabled={busy} className="h-11 px-6 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-50">
            {busy ? "Switching…" : "Use this link"}
          </button>
          <a href="/" className="h-11 flex items-center justify-center border border-steel/40 text-chalk font-body text-sm">
            Stay signed in as {currentEmail}
          </a>
        </div>
      </div>
    </main>
  );
}
