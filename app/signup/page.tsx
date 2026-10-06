"use client";

import { useState } from "react";
import Link from "next/link";
import { LegalAcceptance } from "@/components/legal/legal-acceptance";
import { LegalLinks } from "@/components/legal/legal-links";

export default function SignupPage() {
  const [fullName, setFullName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const [emailNote, setEmailNote] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError("Use a password of at least 8 characters.");
      return;
    }
    if (!legalAccepted) {
      setError("Please tick the box to agree before continuing.");
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/coaches/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fullName, orgName, email, password, acceptedLegal: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't create your account.");

      // The account needs a confirmed email before it can sign in, so
      // there's nothing to redirect into yet — the confirmation link
      // (sent to the address just entered) is what gets them signed in.
      setSubmittedEmail(email);
      if (data.confirmationEmailSent === false) {
        setEmailNote("We could not send the email just now. Use the button below to send it again in a few minutes.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create your account.");
      setSubmitting(false);
    }
  }

  async function resend() {
    setEmailNote(null);
    const res = await fetch("/api/auth/resend-confirmation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: submittedEmail }),
    });
    const body = await res.json().catch(() => ({}));
    setEmailNote(res.ok ? "Sent again. Check your inbox and spam folder." : body.error ?? "We could not send it. Try again in a few minutes.");
  }

  if (submittedEmail) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6 text-center">
        <div className="max-w-sm">
          <h1 className="font-display uppercase text-2xl font-bold">Check your email</h1>
          <p className="font-body text-steel text-sm mt-3">
            We sent a confirmation link to <span className="text-chalk">{submittedEmail}</span>. Click it
            to activate your account and sign in — your organization is already set up and waiting.
          </p>
          <button type="button" onClick={resend} className="font-body text-sm text-rust underline underline-offset-2 mt-4">
            Send the email again
          </button>
          {emailNote && <p className="font-body text-xs text-steel mt-2">{emailNote}</p>}
          <p className="font-body text-xs text-steel mt-4">
            Wrong address?{" "}
            <button type="button" onClick={() => { setSubmittedEmail(null); setSubmitting(false); }} className="text-rust underline underline-offset-2">
              Go back
            </button>{" "}
            (if it was already used, <Link href="/login" className="text-rust">sign in</Link>).
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <h1 className="font-display uppercase text-3xl font-bold text-center">
          Start coaching
        </h1>
        <p className="font-body text-steel text-sm text-center mt-2 mb-8">
          Create your account and your own organization in one step.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="full-name" className="font-body text-xs text-steel uppercase tracking-wide">
              Your name
            </label>
            <input
              id="full-name"
              type="text"
              autoComplete="name"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full h-11 mt-1 bg-surface border border-steel/30 text-chalk px-3 font-body focus:outline-none focus:border-rust"
            />
          </div>

          <div>
            <label htmlFor="org-name" className="font-body text-xs text-steel uppercase tracking-wide">
              Organization name
            </label>
            <input
              id="org-name"
              type="text"
              required
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="e.g. Iron Yard Athletics"
              className="w-full h-11 mt-1 bg-surface border border-steel/30 text-chalk px-3 font-body focus:outline-none focus:border-rust"
            />
          </div>

          <div>
            <label htmlFor="email" className="font-body text-xs text-steel uppercase tracking-wide">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full h-11 mt-1 bg-surface border border-steel/30 text-chalk px-3 font-body focus:outline-none focus:border-rust"
            />
          </div>

          <div>
            <label htmlFor="password" className="font-body text-xs text-steel uppercase tracking-wide">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-11 mt-1 bg-surface border border-steel/30 text-chalk px-3 font-body focus:outline-none focus:border-rust"
            />
          </div>

          <LegalAcceptance checked={legalAccepted} onChange={setLegalAccepted} />

          {error && (
            <p className="font-body text-sm text-rust" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full h-12 bg-rust text-graphite font-display uppercase text-lg font-bold disabled:opacity-40 active:bg-rust/80 transition-colors"
          >
            {submitting ? "Creating…" : "Create my organization"}
          </button>
        </form>

        <p className="font-body text-sm text-steel text-center mt-4">
          Already have an account?{" "}
          <Link href="/login" className="text-rust">
            Sign in
          </Link>
        </p>
        <LegalLinks className="mt-6" />
      </div>
    </main>
  );
}
