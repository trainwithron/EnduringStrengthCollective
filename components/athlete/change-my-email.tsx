"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { validateClaimEmail } from "@/lib/client-claim";
import { appOriginBrowser } from "@/lib/app-url";

// A person changes THEIR OWN sign-in email. The address on the account only changes after they tap the confirmation link sent to the NEW address, so a typo or a
// stranger's address can never take over the account. (A coach cannot change a client's email once the client has signed in: they ask the client to do this.)
export function ChangeMyEmail({ currentEmail }: { currentEmail: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const problem = validateClaimEmail(email, confirm);
    if (problem) {
      setError(problem);
      return;
    }
    if (email.trim().toLowerCase() === currentEmail.toLowerCase()) {
      setError("That is already your email.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: updateError } = await createBrowserClient().auth.updateUser({ email: email.trim().toLowerCase() }, { emailRedirectTo: `${appOriginBrowser()}/confirm-email` });
    setBusy(false);
    if (updateError) {
      setError(/rate limit|seconds|too many/i.test(updateError.message) ? "A confirmation was just sent. Wait a minute and try again." : /already|registered/i.test(updateError.message) ? "That email already has an account." : "That didn't work. Check the address and try again.");
      return;
    }
    setSentTo(email.trim().toLowerCase());
  }

  if (sentTo) {
    return (
      <p className="font-body text-sm text-chalk mt-2" role="status">
        We sent a link to {sentTo}. Your sign-in email changes after you tap it. Until then, keep signing in with {currentEmail}.
      </p>
    );
  }

  return (
    <div className="mt-2">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="font-body text-sm text-steel underline underline-offset-2 min-h-[44px]">
          Change my email
        </button>
      ) : (
        <form onSubmit={submit} className="space-y-2 max-w-sm">
          <label className="block font-body text-xs text-steel">
            New email
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full h-11 mt-1 bg-surface border border-steel/30 text-chalk px-3 font-body focus:outline-none focus:border-rust" />
          </label>
          <label className="block font-body text-xs text-steel">
            Type it again
            <input type="email" autoComplete="off" required value={confirm} onChange={(e) => setConfirm(e.target.value)} className="w-full h-11 mt-1 bg-surface border border-steel/30 text-chalk px-3 font-body focus:outline-none focus:border-rust" />
          </label>
          <p className="font-body text-xs text-steel">We will send a link to the new address. Your email changes only after you tap it.</p>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="h-11 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-50">
              {busy ? "Sending…" : "Send the link"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="h-11 px-4 border border-steel/40 text-chalk font-body text-sm">
              Cancel
            </button>
          </div>
          {error && (
            <p className="font-body text-xs text-rust" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
