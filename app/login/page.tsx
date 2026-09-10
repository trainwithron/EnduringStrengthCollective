"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { isStandaloneDisplay, isMobileUserAgent } from "@/lib/pwa";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const supabase = createBrowserClient();
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError || !data.user) {
      setError(signInError?.message ?? "Sign in failed.");
      setSubmitting(false);
      return;
    }

    // Honor ?next= from the auth middleware redirect, but only a same-origin
    // relative path — never forward an external URL from the query string.
    const next = searchParams.get("next");
    if (next && next.startsWith("/") && !next.startsWith("//")) {
      router.push(next);
      router.refresh();
      return;
    }

    // No group-picker screen exists yet — send the athlete/coach straight to
    // their first group rather than a dead-end home page. A coach at an
    // actual computer goes to the desktop shell (Clients); athletes, and a
    // coach on a phone — installed app or just a browser tab — land on the
    // mobile group hub instead. Logging your own training doesn't need the
    // desktop tools, and that's most coaches' first-ever open of this app.
    const { data: membership } = await supabase
      .from("group_memberships")
      .select("group_id, role")
      .eq("profile_id", data.user.id)
      .limit(1)
      .single();

    if (membership) {
      const wantsMobileHome =
        membership.role !== "coach" || isStandaloneDisplay() || isMobileUserAgent();
      const destination = wantsMobileHome ? `/groups/${membership.group_id}` : "/dashboard";
      router.push(destination);
    } else {
      router.push("/");
    }
    router.refresh();
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="font-display uppercase text-3xl font-bold text-center">
          The Enduring Strength Collective
        </h1>
        <p className="font-body text-steel text-sm text-center mt-2 mb-8">
          Sign in to your team
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
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
              autoComplete="current-password"
              required
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
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="font-body text-sm text-steel text-center mt-4">
          <Link href="/forgot-password" className="text-rust">
            Forgot password?
          </Link>
        </p>
        <p className="font-body text-sm text-steel text-center mt-2">
          New coach?{" "}
          <Link href="/signup" className="text-rust">
            Create your organization
          </Link>
        </p>
      </div>
    </main>
  );
}
