"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { isPlaceholderEmail, validateClaimEmail, validateNewPassword } from "@/lib/client-claim";
import { loadStartInputs, pickStartGroup } from "@/lib/start-group";
import { LegalAcceptance } from "@/components/legal/legal-acceptance";
import { LegalLinks } from "@/components/legal/legal-links";
import { LEGAL_VERSIONS } from "@/lib/legal";
import { recordLegalConsentNow } from "@/lib/legal-client";

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
  // A client the coach set up before they ever signed in has a placeholder
  // address; they enter their real email here.
  const [needsEmail, setNeedsEmail] = useState(false);
  const [email, setEmail] = useState("");
  const [emailConfirm, setEmailConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Shown once: only when this person has not already accepted the current beta notice.
  const [needsLegal, setNeedsLegal] = useState(false);
  const [legalAccepted, setLegalAccepted] = useState(false);

  useEffect(() => {
    // The invite email's link establishes a real session client-side
    // (Supabase's own library reads it from the URL fragment on load) —
    // this just confirms one actually landed before showing the form.
    const supabase = createBrowserClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setHasSession(!!user);
      setNeedsEmail(isPlaceholderEmail(user?.email));
      if (user) {
        // If the table is not there yet this errors and the box is simply shown, which is the safe default.
        supabase
          .from("legal_acceptances")
          .select("id")
          .eq("profile_id", user.id)
          .eq("document", "beta_notice")
          .eq("version", LEGAL_VERSIONS.beta_notice)
          .maybeSingle()
          .then(({ data, error: acceptedError }) => setNeedsLegal(!!acceptedError || !data));
      }
      setChecking(false);
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const passwordError = validateNewPassword(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }
    if (needsEmail) {
      const emailError = validateClaimEmail(email, emailConfirm);
      if (emailError) {
        setError(emailError);
        return;
      }
    }
    if (needsLegal && !legalAccepted) {
      setError("Please tick the box to agree before continuing.");
      return;
    }
    setSubmitting(true);
    setError(null);

    const supabase = createBrowserClient();

    // One server step saves the password (and, for a coach-created account, the real
    // email) together, so a taken or mistyped email can never leave them with a new
    // password and no way in. It also records that they've signed in.
    const claimRes = await fetch("/api/clients/complete-claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, emailConfirm, password }),
    });
    if (!claimRes.ok) {
      const data = await claimRes.json().catch(() => ({}));
      setError(data.error || "Couldn't finish setting up your account — try again.");
      setSubmitting(false);
      return;
    }

    if (needsLegal) await recordLegalConsentNow();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }

    // Same "find their first group, route in" logic as app/login/page.tsx.
    const membership = pickStartGroup(await loadStartInputs(supabase, user.id));

    // New clients added via the Add Client flow are flagged
    // intake_required — send them to the PAR-Q+/waiver intake first,
    // instead of straight into their group. Existing accounts (never
    // flagged) are completely unaffected.
    const { data: profile } = await supabase
      .from("profiles")
      .select("intake_required")
      .eq("id", user.id)
      .maybeSingle();

    if (profile?.intake_required) {
      const { data: intake } = await supabase
        .from("client_intake")
        .select("completed_at")
        .eq("athlete_id", user.id)
        .maybeSingle();

      if (!intake?.completed_at) {
        const next = membership ? `/groups/${membership.group_id}?welcome=1` : "/";
        router.push(`/intake?next=${encodeURIComponent(next)}`);
        router.refresh();
        return;
      }
    }

    router.push(membership ? `/groups/${membership.group_id}?welcome=1` : "/");
    router.refresh();
  }

  if (checking) return null;

  if (!hasSession) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6 text-center">
        <div>
          <h1 className="font-display uppercase text-2xl font-bold">Link invalid or expired</h1>
          <p className="font-body text-steel text-sm mt-2 max-w-sm">
            This link has expired or was already used. If you have already chosen a password, sign in. If
            not, ask your coach to send you a new link.
          </p>
          <a
            href="/login"
            className="inline-flex items-center justify-center h-11 px-6 mt-5 bg-rust text-graphite font-body text-sm font-medium"
          >
            Sign in
          </a>
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

        {needsEmail && (
          <div className="mb-4">
            <label htmlFor="email" className="font-body text-xs text-steel uppercase tracking-wide">
              Your email
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
            <label htmlFor="email-confirm" className="font-body text-xs text-steel uppercase tracking-wide mt-3 block">
              Type it again
            </label>
            <input
              id="email-confirm"
              type="email"
              autoComplete="off"
              required
              value={emailConfirm}
              onChange={(e) => setEmailConfirm(e.target.value)}
              onPaste={(e) => e.preventDefault()}
              className="w-full h-11 mt-1 bg-surface border border-steel/30 text-chalk px-3 font-body focus:outline-none focus:border-rust"
            />
            <p className="font-body text-xs text-steel mt-1">
              You&apos;ll use this to sign in and reset your password, so make sure it&apos;s right.
            </p>
          </div>
        )}

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

        {needsLegal && (
          <div className="mt-4">
            <LegalAcceptance checked={legalAccepted} onChange={setLegalAccepted} />
          </div>
        )}

        <p className="font-body text-xs text-steel mt-4 max-w-[44ch]">
          On an iPhone: finish this step first, then add the app to your Home Screen, then sign in once inside the
          app. The Home Screen app doesn&apos;t share your sign-in from Safari.
        </p>

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
        <LegalLinks className="mt-5" />
      </form>
    </main>
  );
}
