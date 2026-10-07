"use client";

import Link from "next/link";
import { useState } from "react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    // Sent from the server so the link works on any device (a link made in this browser only works in this browser).
    let message: string | null = null;
    try {
      const res = await fetch("/api/auth/forgot-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: email.trim().toLowerCase() }) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        message = data.error || "We couldn't send that. Check the email address and try again.";
      }
    } catch {
      message = "We couldn't send that. Check your connection and try again.";
    }

    setSubmitting(false);
    if (message) {
      setError(message);
      return;
    }
    setSent(true);
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="font-display uppercase text-2xl font-bold text-center">
          Reset your password
        </h1>

        {sent ? (
          <p className="font-body text-steel text-sm text-center mt-4">
            If an account exists for that email, a reset link is on its way.
            Check your inbox and follow the link to set a new password.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
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
              {submitting ? "Sending…" : "Send reset link"}
            </button>
          </form>
        )}

        <p className="font-body text-sm text-steel text-center mt-6">
          <Link href="/login" className="text-rust">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
