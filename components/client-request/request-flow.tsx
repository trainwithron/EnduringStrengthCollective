"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";
import { saved } from "@/lib/saved";
import { LegalAcceptance } from "@/components/legal/legal-acceptance";
import { LegalLinks } from "@/components/legal/legal-links";
import { flushLegalConsent, rememberLegalConsent } from "@/lib/legal-client";
import { friendlySignInError } from "@/lib/sign-in-errors";

type Mode = "signup" | "login";
type Phase = "checking" | "guest" | "authed" | "awaiting-confirmation" | "sent" | "stopped";

// "Request to train with me" from a coach's public page. A visitor makes an account or signs in (then lands back here, because the confirmation email returns to this same page), taps ONE button, and is told it was sent.
// Nothing here joins anything: the request waits for the coach. A new account made here is a plain account (no intake is asked until the coach approves). The date of birth is asked only when none is on file yet.
export function RequestFlow({ slug, coachName }: { slug: string; coachName: string }) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [mode, setMode] = useState<Mode>("signup");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [dob, setDob] = useState("");
  const [needsDob, setNeedsDob] = useState(true);
  const [authedEmail, setAuthedEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stopped, setStopped] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [resendNote, setResendNote] = useState<string | null>(null);
  const first = coachName.split(" ")[0] || "your coach";
  const here = `/c/${slug}/request`;

  async function startAuthed(supabase: ReturnType<typeof createBrowserClient>, userId: string, email: string | null | undefined, nameFromMeta: string | null) {
    setAuthedEmail(email ?? null);
    const { data: profile } = await supabase.from("profiles").select("id").eq("id", userId).maybeSingle();
    if (!profile) {
      const name = nameFromMeta || email?.split("@")[0] || "New member";
      if (!(await saved(supabase.from("profiles").insert({ id: userId, full_name: name })))) {
        setError("We couldn't set up your account. Refresh the page to try again.");
        setPhase("guest");
        return;
      }
    }
    // a date of birth already on file is not asked again
    const [intake, details] = await Promise.all([
      supabase.from("client_intake").select("date_of_birth").eq("athlete_id", userId).maybeSingle(),
      supabase.from("athlete_profile_details").select("birthday").eq("athlete_id", userId).maybeSingle(),
    ]);
    setNeedsDob(!((intake.data as { date_of_birth?: string | null } | null)?.date_of_birth || (details.data as { birthday?: string | null } | null)?.birthday));
    setPhase("authed");
    void flushLegalConsent();
  }

  useEffect(() => {
    const supabase = createBrowserClient();
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return setPhase("guest");
      await startAuthed(supabase, user.id, user.email, (user.user_metadata?.full_name as string | undefined) ?? null);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const supabase = createBrowserClient();
    if (mode === "signup") {
      const name = fullName.trim();
      if (!name) {
        setError("Enter your name.");
        setSubmitting(false);
        return;
      }
      if (!legalAccepted) {
        setError("Please tick the box to agree before continuing.");
        setSubmitting(false);
        return;
      }
      rememberLegalConsent();
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: { data: { full_name: name }, emailRedirectTo: `${window.location.origin}${here}` },
      });
      if (signUpError) {
        setError(
          /already registered|already exists/i.test(signUpError.message)
            ? "That email already has an account. Tap 'I have an account' to sign in."
            : /rate limit|too many/i.test(signUpError.message)
            ? "Too many tries. Wait a few minutes and try again."
            : "We couldn't create the account. Check your email and password and try again."
        );
        setSubmitting(false);
        return;
      }
      if (data.session && data.user) {
        await startAuthed(supabase, data.user.id, data.user.email, name);
        setSubmitting(false);
        return;
      }
      setPhase("awaiting-confirmation");
      setSubmitting(false);
      return;
    }
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (signInError || !data.user) {
      setError(friendlySignInError(signInError?.message).message);
      setSubmitting(false);
      return;
    }
    await startAuthed(supabase, data.user.id, data.user.email, (data.user.user_metadata?.full_name as string | undefined) ?? null);
    setSubmitting(false);
  }

  async function handleResend() {
    setSubmitting(true);
    setError(null);
    const { error: resendError } = await createBrowserClient().auth.resend({ type: "signup", email: email.trim().toLowerCase(), options: { emailRedirectTo: `${window.location.origin}${here}` } });
    if (resendError) setError(resendError.message);
    else setResendNote(`Sent again to ${email}. It can take a minute; check spam too.`);
    setSubmitting(false);
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (needsDob && !dob) return setError("Please enter your date of birth.");
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/client-requests/submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug, dob: needsDob ? dob : null }) });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setPhase("sent");
        return;
      }
      if (["under_13", "not_taking", "already_client", "declined_recently", "own_page", "coach_full"].includes(data.code)) {
        setStopped(data.error);
        setPhase("stopped");
        return;
      }
      if (data.code === "dob_needed") setNeedsDob(true);
      setError(data.error || "Couldn't send the request. Try again.");
    } catch {
      setError("Couldn't send the request. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const back = (
    <Link href={`/c/${slug}`} className="inline-flex items-center justify-center h-11 px-6 mt-5 bg-rust text-graphite font-body text-sm font-medium">
      Back to {first}&apos;s page
    </Link>
  );

  const header = (
    <div className="text-center mb-6">
      <h1 className="font-display uppercase text-2xl font-bold">Request to train with {coachName}</h1>
      <p className="font-body text-steel text-sm mt-2">{first} will see your request and decide. You are not added to anything until then.</p>
    </div>
  );

  if (phase === "checking") return null;

  if (phase === "sent") {
    return (
      <div className="w-full max-w-sm text-center" role="status">
        <h1 className="font-display uppercase text-2xl font-bold">Sent</h1>
        <p className="font-body text-steel text-sm mt-3">{first} will get back to you.</p>
        {back}
      </div>
    );
  }

  if (phase === "stopped") {
    return (
      <div className="w-full max-w-sm text-center">
        <h1 className="font-display uppercase text-2xl font-bold">We couldn&apos;t send that</h1>
        <p className="font-body text-steel text-sm mt-3">{stopped}</p>
        {back}
      </div>
    );
  }

  if (phase === "awaiting-confirmation") {
    return (
      <div className="w-full max-w-sm text-center">
        <h1 className="font-display uppercase text-2xl font-bold">Check your email</h1>
        <p className="font-body text-steel text-sm mt-3">
          We sent a confirmation link to <span className="text-chalk">{email}</span>. Open it and it brings you back here to send your request to {coachName}.
        </p>
        {resendNote && (
          <p className="font-body text-sm text-chalk mt-3" role="status">
            {resendNote}
          </p>
        )}
        {error && (
          <p className="font-body text-sm text-rust mt-3" role="alert">
            {error}
          </p>
        )}
        <div className="mt-6 flex flex-col gap-3">
          <button type="button" onClick={handleResend} disabled={submitting} className="h-11 border border-steel/40 text-chalk font-display uppercase text-sm font-bold disabled:opacity-40">
            {submitting ? "Sending…" : "Send the email again"}
          </button>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setMode("login");
              setPhase("guest");
            }}
            className="font-body text-sm text-steel underline"
          >
            Already confirmed? Sign in
          </button>
        </div>
      </div>
    );
  }

  if (phase === "authed") {
    return (
      <form onSubmit={handleSend} className="w-full max-w-sm">
        {header}
        <p className="font-body text-steel text-xs text-center -mt-3 mb-4">
          Signed in as <span className="text-chalk">{authedEmail}</span>.
        </p>
        {needsDob && (
          <div className="mt-4">
            <label htmlFor="req-dob" className="font-body text-xs text-steel uppercase tracking-wide">
              Your date of birth
            </label>
            <input id="req-dob" type="date" required value={dob} onChange={(e) => setDob(e.target.value)} className="w-full h-11 mt-1 bg-surface border border-steel/30 text-chalk px-3 font-body focus:outline-none focus:border-rust" />
            <p className="font-body text-xs text-steel mt-1">Coaching here is for ages 13 and up. Under 18 needs a parent or guardian to sign a consent form once you are accepted.</p>
          </div>
        )}
        {error && (
          <p className="font-body text-sm text-rust mt-3" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={submitting} className="w-full h-12 mt-5 bg-rust text-graphite font-display uppercase text-lg font-bold disabled:opacity-40">
          {submitting ? "Sending…" : "Send request"}
        </button>
        <button
          type="button"
          onClick={async () => {
            await createBrowserClient().auth.signOut();
            setError(null);
            setPassword("");
            setMode("login");
            setPhase("guest");
          }}
          className="block mx-auto mt-4 font-body text-sm text-steel underline"
        >
          Not you? Use a different account
        </button>
      </form>
    );
  }

  return (
    <div className="w-full max-w-sm">
      {header}
      <div className="flex border border-steel/30 mb-5">
        <button type="button" onClick={() => setMode("signup")} className={`flex-1 h-10 font-body text-sm ${mode === "signup" ? "bg-rust text-graphite" : "text-steel"}`}>
          Create account
        </button>
        <button type="button" onClick={() => setMode("login")} className={`flex-1 h-10 font-body text-sm ${mode === "login" ? "bg-rust text-graphite" : "text-steel"}`}>
          I have an account
        </button>
      </div>
      <form onSubmit={handleAuth} className="space-y-4">
        {mode === "signup" && (
          <div>
            <label htmlFor="req-name" className="font-body text-xs text-steel uppercase tracking-wide">
              Full name
            </label>
            <input id="req-name" type="text" required value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full h-11 mt-1 bg-surface border border-steel/30 text-chalk px-3 font-body focus:outline-none focus:border-rust" />
          </div>
        )}
        <div>
          <label htmlFor="req-email" className="font-body text-xs text-steel uppercase tracking-wide">
            Email
          </label>
          <input id="req-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full h-11 mt-1 bg-surface border border-steel/30 text-chalk px-3 font-body focus:outline-none focus:border-rust" />
        </div>
        <div>
          <label htmlFor="req-password" className="font-body text-xs text-steel uppercase tracking-wide">
            Password
          </label>
          <input id="req-password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className="w-full h-11 mt-1 bg-surface border border-steel/30 text-chalk px-3 font-body focus:outline-none focus:border-rust" />
        </div>
        {mode === "signup" && <LegalAcceptance checked={legalAccepted} onChange={setLegalAccepted} />}
        {error && (
          <p className="font-body text-sm text-rust" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={submitting} className="w-full h-12 bg-rust text-graphite font-display uppercase text-lg font-bold disabled:opacity-40">
          {submitting ? (mode === "signup" ? "Creating account…" : "Signing in…") : mode === "signup" ? "Create account" : "Sign in"}
        </button>
        <LegalLinks className="mt-2" />
      </form>
    </div>
  );
}
