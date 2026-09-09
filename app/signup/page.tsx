"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/coaches/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fullName, orgName, email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't create your account.");

      // Same credentials the person just typed into this form — signing
      // them in immediately after their own signup, same as any normal
      // "create account" flow anywhere else.
      const supabase = createBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        // Account exists either way — send them to sign in by hand rather
        // than get stuck on an error here.
        router.push("/login");
        return;
      }

      router.push(`/groups/${data.groupId}/branding`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create your account.");
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <h1 className="font-display uppercase text-3xl font-bold text-center">
          Start Coaching
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
              placeholder="e.g. Coast to Coast Fitness"
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
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
            {submitting ? "Creating…" : "Create my organization"}
          </button>
        </form>

        <p className="font-body text-sm text-steel text-center mt-4">
          Already have an account?{" "}
          <Link href="/login" className="text-rust">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
