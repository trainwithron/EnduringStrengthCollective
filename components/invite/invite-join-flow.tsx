"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

type Mode = "signup" | "login";
type Phase = "checking" | "guest" | "authed" | "awaiting-confirmation";

// A signup stashes {email, name} here so the name survives the round trip to
// the confirmation email and back (profiles can't be created until there's a
// confirmed session). Keyed by invite code only, so it must be validated
// against the resuming session's email before use — otherwise an abandoned
// signup attempt (e.g. a rate-limited email) can leak its name onto a
// completely different account that later signs in on the same browser.
function readPendingName(code: string, email: string | null | undefined): string | null {
  const raw = window.localStorage.getItem(`invite_pending_signup_${code}`);
  if (!raw) return null;
  try {
    const { email: stashedEmail, name } = JSON.parse(raw) as { email: string; name: string };
    return stashedEmail === email ? name : null;
  } catch {
    return null;
  }
}

// Ensures a profile row exists for a signed-in user before anything tries to
// insert a group_memberships row referencing it (profile_id has a foreign
// key into profiles). Signup normally creates this inline; this covers every
// other path that can land here with a session and no profile yet — a
// resumed email-confirmation redirect, a login, or any future auth route.
async function ensureProfile(
  supabase: ReturnType<typeof createBrowserClient>,
  userId: string,
  email: string | null | undefined,
  code: string
) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();

  if (!profile) {
    const name = readPendingName(code, email) || email?.split("@")[0] || "New member";
    await supabase.from("profiles").insert({ id: userId, full_name: name });
    window.localStorage.removeItem(`invite_pending_signup_${code}`);
  }
}

export function InviteJoinFlow({
  code,
  groupId,
  groupName,
}: {
  code: string;
  groupId: string;
  groupName: string;
}) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [mode, setMode] = useState<Mode>("signup");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authedEmail, setAuthedEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const supabase = createBrowserClient();

    async function checkSession() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setPhase("guest");
        return;
      }

      setAuthedEmail(user.email ?? null);

      const { data: membership } = await supabase
        .from("group_memberships")
        .select("group_id")
        .eq("group_id", groupId)
        .eq("profile_id", user.id)
        .maybeSingle();

      if (membership) {
        router.push(`/groups/${groupId}`);
        return;
      }

      await ensureProfile(supabase, user.id, user.email, code);
      setPhase("authed");
    }

    checkSession();
  }, [code, groupId, router]);

  async function handleJoin() {
    setSubmitting(true);
    setError(null);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setSubmitting(false);
      return;
    }

    const { error: joinError } = await supabase.from("group_memberships").insert({
      group_id: groupId,
      profile_id: user.id,
      role: "athlete",
    });

    if (joinError) {
      setError("Couldn't join the group. Try again.");
      setSubmitting(false);
      return;
    }

    window.localStorage.removeItem(`invite_pending_signup_${code}`);
    router.push(`/groups/${groupId}`);
    router.refresh();
  }

  async function handleAuthSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const supabase = createBrowserClient();

    if (mode === "signup") {
      const trimmedName = fullName.trim();
      if (!trimmedName) {
        setError("Enter your name.");
        setSubmitting(false);
        return;
      }

      window.localStorage.setItem(
        `invite_pending_signup_${code}`,
        JSON.stringify({ email, name: trimmedName })
      );

      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/invite/${code}`,
        },
      });

      if (signUpError) {
        setError(signUpError.message);
        setSubmitting(false);
        return;
      }

      if (data.session && data.user) {
        await supabase.from("profiles").insert({ id: data.user.id, full_name: trimmedName });
        window.localStorage.removeItem(`invite_pending_signup_${code}`);
        setAuthedEmail(data.user.email ?? null);
        setPhase("authed");
        setSubmitting(false);
        return;
      }

      setPhase("awaiting-confirmation");
      setSubmitting(false);
      return;
    }

    // mode === "login"
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError || !data.user) {
      setError(signInError?.message ?? "Sign in failed.");
      setSubmitting(false);
      return;
    }

    const { data: membership } = await supabase
      .from("group_memberships")
      .select("group_id")
      .eq("group_id", groupId)
      .eq("profile_id", data.user.id)
      .maybeSingle();

    if (membership) {
      router.push(`/groups/${groupId}`);
      router.refresh();
      return;
    }

    await ensureProfile(supabase, data.user.id, data.user.email, code);
    setAuthedEmail(data.user.email ?? null);
    setPhase("authed");
    setSubmitting(false);
  }

  if (phase === "checking") {
    return null;
  }

  if (phase === "awaiting-confirmation") {
    return (
      <div className="w-full max-w-sm text-center">
        <h1 className="font-display uppercase text-2xl font-bold">Check your email</h1>
        <p className="font-body text-steel text-sm mt-3">
          We sent a confirmation link to <span className="text-chalk">{email}</span>. Click it,
          then come back to this page to finish joining{" "}
          <span className="text-chalk">{groupName}</span>.
        </p>
      </div>
    );
  }

  if (phase === "authed") {
    return (
      <div className="w-full max-w-sm text-center">
        <h1 className="font-display uppercase text-2xl font-bold">{groupName}</h1>
        <p className="font-body text-steel text-sm mt-3">
          Signed in as <span className="text-chalk">{authedEmail}</span>.
        </p>
        {error && (
          <p className="font-body text-sm text-rust mt-3" role="alert">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={handleJoin}
          disabled={submitting}
          className="w-full h-12 mt-5 bg-rust text-graphite font-display uppercase text-lg font-bold disabled:opacity-40 active:bg-rust/80 transition-colors"
        >
          {submitting ? "Joining…" : `Join ${groupName}`}
        </button>
      </div>
    );
  }

  // phase === "guest"
  return (
    <div className="w-full max-w-sm">
      <h1 className="font-display uppercase text-2xl font-bold text-center">
        You&apos;re invited
      </h1>
      <p className="font-body text-steel text-sm text-center mt-2 mb-6">
        Join <span className="text-chalk">{groupName}</span> on The Enduring Strength
        Collective.
      </p>

      <div className="flex border border-steel/30 mb-5">
        <button
          type="button"
          onClick={() => setMode("signup")}
          className={`flex-1 h-10 font-body text-sm ${
            mode === "signup" ? "bg-rust text-graphite" : "text-steel"
          }`}
        >
          Create account
        </button>
        <button
          type="button"
          onClick={() => setMode("login")}
          className={`flex-1 h-10 font-body text-sm ${
            mode === "login" ? "bg-rust text-graphite" : "text-steel"
          }`}
        >
          I have an account
        </button>
      </div>

      <form onSubmit={handleAuthSubmit} className="space-y-4">
        {mode === "signup" && (
          <div>
            <label
              htmlFor="fullName"
              className="font-body text-xs text-steel uppercase tracking-wide"
            >
              Full name
            </label>
            <input
              id="fullName"
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full h-11 mt-1 bg-surface border border-steel/30 text-chalk px-3 font-body focus:outline-none focus:border-rust"
            />
          </div>
        )}

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
          <label
            htmlFor="password"
            className="font-body text-xs text-steel uppercase tracking-wide"
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
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
          {submitting
            ? mode === "signup"
              ? "Creating account…"
              : "Signing in…"
            : mode === "signup"
            ? "Create account & join"
            : "Sign in & join"}
        </button>
      </form>
    </div>
  );
}
