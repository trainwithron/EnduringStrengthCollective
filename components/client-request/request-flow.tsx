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
type Phase = "checking" | "guest" | "authed" | "awaiting-confirmation" | "sent" | "sent-unconfirmed" | "stopped";

// "Request to train with me" from a coach's public page. A NEW visitor fills in one form (name, email, password, date of birth) and the account and the request are made together, so the coach
// hears at once, before the email is confirmed (Ron, Oct 31: a new client at the gym never found the confirmation email, so the request never went). Someone with an account signs in and taps ONE button.
// Nothing here joins anything: the request waits for the coach. A new account made here is a plain account (no intake is asked until the coach approves). The date of birth is asked only when none is on file yet.
// logoUrl / orgName: the organization's logo chip from the coach's public page, so the form looks like the page it came from (optional; the page passes them when it has them).
export function RequestFlow({ slug, coachName, coachId, logoUrl = null, orgName = null }: { slug: string; coachName: string; coachId: string; logoUrl?: string | null; orgName?: string | null }) {
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
    // already asked (the request was sent when the account was made, and the confirmation link brings them back here): say so, not Send again
    const { data: waiting } = await supabase.from("client_requests").select("id").eq("coach_id", coachId).eq("status", "pending").limit(1).maybeSingle();
    if (waiting) {
      setPhase("sent");
      void flushLegalConsent();
      return;
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
      if (!dob) {
        setError("Please enter your date of birth.");
        setSubmitting(false);
        return;
      }
      rememberLegalConsent();
      try {
        const res = await fetch("/api/client-requests/signup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slug, name, email: email.trim().toLowerCase(), password, dob }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          if (data.confirmed) void flushLegalConsent();
          setPhase(data.confirmed ? "sent" : "sent-unconfirmed");
        } else if (data.code === "has_account") {
          // the toggle is switched for them, so the message says what to do on the screen they now see
          setMode("login");
          setError("That email already has an account. Enter its password below and tap Sign in.");
        } else if (["under_13", "not_taking", "already_client", "declined_recently", "own_page", "coach_full"].includes(data.code)) {
          setStopped(data.error);
          setPhase("stopped");
        } else if (data.accountMade) {
          setError(data.error);
          setPhase("awaiting-confirmation");
        } else {
          setError(data.error || "We couldn't create the account. Check your email and password and try again.");
        }
      } catch {
        setError("Couldn't send. Check your connection and try again.");
      }
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

  // A quiet way back to the coach's page from the form itself (the result screens get the big button).
  const backLink = (
    <Link href={`/c/${slug}`} className="inline-flex items-center justify-center min-h-11 px-2 mx-auto mt-2 font-body text-sm text-steel underline">
      &larr; Back to {first}&apos;s page
    </Link>
  );

  const header = (
    <div className="text-center mb-6">
      {logoUrl && (
        <div className="inline-flex items-center gap-2.5 py-2 pl-2.5 pr-3.5 mb-4" style={{ background: "#F2EEE6" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- public Supabase Storage URL. */}
          <img src={logoUrl} alt={orgName ?? ""} className="h-8 w-auto" />
          {orgName && <span className="font-display font-semibold uppercase tracking-wider text-sm text-[#111111]">{orgName}</span>}
        </div>
      )}
      <h1 className="font-display uppercase text-2xl font-bold">Request to train with {coachName}</h1>
      <p className="font-body text-steel text-sm mt-2">{first} will see your request and decide. You are not added to anything until then.</p>
    </div>
  );

  // What happens after the coach says yes: said on both Sent screens, so nobody is left wondering how to get in.
  const nextStep = (
    <p className="font-body text-steel text-sm mt-3">
      When {first} accepts, we&apos;ll email you. Then sign in at <span className="text-chalk">spotlightcoaching.app/login</span> and the app takes you through a short health form.
    </p>
  );

  if (phase === "checking") {
    return (
      <div className="w-full max-w-sm">
        {header}
        <p className="font-body text-steel text-sm text-center" role="status">
          Loading…
        </p>
      </div>
    );
  }

  if (phase === "sent") {
    return (
      <div className="w-full max-w-sm text-center" role="status">
        <h1 className="font-display uppercase text-2xl font-bold">Sent</h1>
        <p className="font-body text-steel text-sm mt-3">{first} will get back to you.</p>
        {nextStep}
        {back}
        {!authedEmail && (
          <Link href="/login" className="flex items-center justify-center min-h-11 px-2 mx-auto mt-2 font-body text-sm text-steel underline">
            Sign in
          </Link>
        )}
      </div>
    );
  }

  if (phase === "sent-unconfirmed") {
    return (
      <div className="w-full max-w-sm text-center" role="status">
        <h1 className="font-display uppercase text-2xl font-bold">Sent</h1>
        <p className="font-body text-steel text-sm mt-3">{first} can see your request now.</p>
        <p className="font-body text-steel text-sm mt-3">
          We also emailed a link to <span className="text-chalk">{email}</span>. Open it to confirm your email, so you can sign in once {first} says yes. It comes from Spotlight Coaching; check spam too.
        </p>
        {nextStep}
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
        <button type="button" onClick={handleResend} disabled={submitting} className="w-full h-11 mt-5 border border-steel/40 text-chalk font-display uppercase text-sm font-bold disabled:opacity-40">
          {submitting ? "Sending…" : "Send the email again"}
        </button>
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
            className="inline-flex items-center justify-center min-h-11 px-2 font-body text-sm text-steel underline"
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
          className="flex items-center justify-center min-h-11 px-2 mx-auto mt-2 font-body text-sm text-steel underline"
        >
          Not you? Use a different account
        </button>
        <div className="flex">{backLink}</div>
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
        {mode === "signup" && (
          <div>
            <label htmlFor="req-signup-dob" className="font-body text-xs text-steel uppercase tracking-wide">
              Your date of birth
            </label>
            <input id="req-signup-dob" type="date" required value={dob} onChange={(e) => setDob(e.target.value)} className="w-full h-11 mt-1 bg-surface border border-steel/30 text-chalk px-3 font-body focus:outline-none focus:border-rust" />
            <p className="font-body text-xs text-steel mt-1">Coaching here is for ages 13 and up. Under 18 needs a parent or guardian to sign a consent form once you are accepted.</p>
          </div>
        )}
        {mode === "signup" && <LegalAcceptance checked={legalAccepted} onChange={setLegalAccepted} />}
        {error && (
          <p className="font-body text-sm text-rust" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={submitting} className="w-full h-12 bg-rust text-graphite font-display uppercase text-lg font-bold disabled:opacity-40">
          {submitting ? (mode === "signup" ? "Sending…" : "Signing in…") : mode === "signup" ? "Create account and send request" : "Sign in"}
        </button>
        <LegalLinks className="mt-2" />
      </form>
      <div className="flex">{backLink}</div>
    </div>
  );
}
