"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

export default function SetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <SetPasswordForm />
    </Suspense>
  );
}

function SetPasswordForm() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // The invite email's link establishes a real session client-side
    // (Supabase's own library reads it from the URL fragment on load) —
    // this just confirms one actually landed before showing the form.
    const supabase = createBrowserClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setHasSession(!!user);
      setChecking(false);
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setSubmitting(true);
    setError(null);

    const supabase = createBrowserClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      setSubmitting(false);
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }

    // Same "find their first group, route in" logic as app/login/page.tsx.
    const { data: membership } = await supabase
      .from("group_memberships")
      .select("group_id")
      .eq("profile_id", user.id)
      .limit(1)
      .maybeSingle();

    router.push(membership ? `/groups/${membership.group_id}` : "/");
    router.refresh();
  }

  if (checking) return null;

  if (!hasSession) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6 text-center">
        <div>
          <h1 className="font-display uppercase text-2xl font-bold">Link invalid or expired</h1>
          <p className="font-body text-steel text-sm mt-2 max-w-sm">
            Ask your coach to resend your invite.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <form onSubmit={handleSubmit} className="w-full max-w-sm">
        <h1 className="font-display uppercase text-2xl font-bold text-center">
          Set your password
        </h1>
        <p className="font-body text-steel text-sm text-center mt-2 mb-6">
          One last step — pick a password and you&apos;re in.
        </p>

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

        {error && (
          <p className="font-body text-sm text-rust mt-3" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full h-12 mt-5 bg-rust text-graphite font-display uppercase text-lg font-bold disabled:opacity-40 active:bg-rust/80 transition-colors"
        >
          {submitting ? "Saving…" : "Set password & continue"}
        </button>
      </form>
    </main>
  );
}
