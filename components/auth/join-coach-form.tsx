"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { validateNewPassword } from "@/lib/client-claim";
import { loadStartInputs, pickStartGroup } from "@/lib/start-group";
import { FRONT_DESK_PATH, landsOnFrontDesk } from "@/lib/front-desk";
import { LegalAcceptance } from "@/components/legal/legal-acceptance";
import { recordLegalConsentNow } from "@/lib/legal-client";

// The invited person chooses their password here. Nothing happens until they press the button: no field is filled in for them and nothing is submitted when the page opens, so only a person reading the page can use up
// the link. The server checks the link, sets the password on the invited account, and the browser then signs in with it.
export function JoinCoachForm({
  token,
  orgName,
  rolePhrase,
  inviterName,
  inviteeName,
  maskedEmail,
  kind,
}: {
  token: string;
  orgName: string;
  rolePhrase: string;
  inviterName: string | null;
  inviteeName: string;
  maskedEmail: string;
  kind: "invite" | "signin";
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [legal, setLegal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [signIn, setSignIn] = useState(false);
  const first = inviteeName.split(" ")[0] || "there";
  const isInvite = kind === "invite";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const problem = validateNewPassword(password);
    if (problem) return setError(problem);
    if (isInvite && !legal) return setError("Please tick the box to agree before continuing.");
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/coaches/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, password }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.email !== "string") {
        setError(data.error || "Couldn't finish. Try again.");
        setSignIn(data.signIn === true);
        setSubmitting(false);
        return;
      }
      const supabase = createBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: data.email, password });
      if (signInError) {
        // the password is saved; only the sign-in step failed
        router.push("/login");
        return;
      }
      if (isInvite) await recordLegalConsentNow();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }
      const membership = pickStartGroup(await loadStartInputs(supabase, user.id));
      if (await landsOnFrontDesk(supabase, user.id, membership)) {
        router.push(FRONT_DESK_PATH);
        router.refresh();
        return;
      }
      router.push(membership ? `/groups/${membership.group_id}?welcome=1` : "/");
      router.refresh();
    } catch {
      setError("Couldn't finish. Check your connection and try again.");
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <form onSubmit={submit} className="w-full max-w-sm">
        <h1 className="font-display uppercase text-2xl font-bold text-center">{isInvite ? `Join ${orgName}` : "Set a new password"}</h1>
        <p className="font-body text-steel text-sm text-center mt-2 mb-6">
          {isInvite
            ? `Hi ${first}. ${inviterName ? `${inviterName} invited` : "You were invited"} you to ${orgName} as ${rolePhrase}. Create your password to join.`
            : `Hi ${first}. Choose a new password for your ${orgName} account, and you will be signed in.`}
        </p>
        {maskedEmail && <p className="font-body text-xs text-steel text-center -mt-4 mb-6">For {maskedEmail}</p>}
        <label htmlFor="join-password" className="font-body text-xs text-steel uppercase tracking-wide">
          Password
        </label>
        <input
          id="join-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full h-11 mt-1 bg-surface border border-steel/30 text-chalk px-3 font-body focus:outline-none focus:border-rust"
        />
        {isInvite && (
          <div className="mt-4">
            <LegalAcceptance checked={legal} onChange={setLegal} />
          </div>
        )}
        {error && (
          <p className="font-body text-sm text-rust mt-4" role="alert">
            {error}{" "}
            {signIn && (
              <a href="/login" className="underline">
                Sign in
              </a>
            )}
          </p>
        )}
        <button type="submit" disabled={submitting} className="w-full h-11 mt-5 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-50">
          {submitting ? "Saving…" : isInvite ? "Create password and join" : "Save password and sign in"}
        </button>
      </form>
    </main>
  );
}
