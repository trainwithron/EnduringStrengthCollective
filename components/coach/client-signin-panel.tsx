"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Circle } from "lucide-react";
import { buildClaimSms, CLAIM_STATUS_LABEL, smsHref, type ClaimStatus } from "@/lib/client-claim";

// The coach's per-client sign-in checklist for a client who hasn't signed in
// yet: account created -> invite link created -> client signed in. The coach
// creates the claim link when they're ready and sends it themselves (a text
// from their own phone, or copy/paste); nothing is ever sent from here.
export function ClientSignInPanel({
  groupId,
  athleteId,
  clientName,
  status,
  coachFirstName,
}: {
  groupId: string;
  athleteId: string;
  clientName: string;
  status: Exclude<ClaimStatus, "active">;
  coachFirstName?: string | null;
}) {
  const router = useRouter();
  const [linkStatus, setLinkStatus] = useState<ClaimStatus>(status);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showEmail, setShowEmail] = useState(false);
  const [email, setEmail] = useState("");
  const [emailMsg, setEmailMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const firstName = clientName.split(" ")[0] ?? "";
  const inviteCreated = linkStatus === "invite_created";

  async function createLink() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/clients/invite-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groupId, athleteId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't create the link.");
      setLink(data.link);
      setLinkStatus("invite_created");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the link.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy — select the link and copy it by hand.");
    }
  }

  async function saveEmail(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setEmailMsg(null);
    try {
      const res = await fetch("/api/clients/fix-email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groupId, athleteId, email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't update the email.");
      setEmailMsg({ kind: "ok", text: "Email saved. Nothing was sent to it." });
      setEmail("");
    } catch (err) {
      setEmailMsg({ kind: "error", text: err instanceof Error ? err.message : "Couldn't update the email." });
    } finally {
      setBusy(false);
    }
  }

  const steps: { label: string; done: boolean }[] = [
    { label: "Account created — you can build their programs and schedule now", done: true },
    { label: "Invite link created", done: inviteCreated },
    { label: "Client signed in", done: false },
  ];

  return (
    <section className="border border-rust/30 bg-rust/5 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display uppercase text-sm tracking-wide text-chalk">Sign-in</h2>
        <span className="font-body text-xs text-steel">{CLAIM_STATUS_LABEL[linkStatus]}</span>
      </div>
      <p className="font-body text-xs text-steel mt-1">
        Nothing is sent to {firstName || "them"} until you give them the link. Everything you set up waits for their
        first sign-in.
      </p>

      <ol className="mt-3 space-y-1.5">
        {steps.map((s) => (
          <li key={s.label} className="flex items-start gap-2 font-body text-sm">
            {s.done ? (
              <Check className="w-4 h-4 mt-0.5 text-positive shrink-0" strokeWidth={2.5} />
            ) : (
              <Circle className="w-4 h-4 mt-0.5 text-steel shrink-0" />
            )}
            <span className={s.done ? "text-chalk" : "text-steel"}>{s.label}</span>
          </li>
        ))}
      </ol>

      {link ? (
        <div className="mt-4">
          <p className="font-body text-xs text-steel mb-1.5">
            One-time link — works once, expires in 14 days. Creating a new one cancels this one.
          </p>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={link}
              onFocus={(e) => e.target.select()}
              className="flex-1 h-11 min-w-0 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs focus:outline-none"
            />
            <button
              type="button"
              onClick={copy}
              className="h-11 px-4 border border-rust text-rust font-body text-sm shrink-0"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <a
            href={smsHref(buildClaimSms(link, firstName, coachFirstName))}
            className="inline-flex items-center justify-center h-11 px-4 mt-2 bg-rust text-graphite font-body text-sm font-medium"
          >
            Text it from my phone
          </a>
        </div>
      ) : (
        <button
          type="button"
          onClick={createLink}
          disabled={busy}
          className="mt-4 h-11 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-50"
        >
          {busy ? "Creating…" : inviteCreated ? "Create a new invite link" : "Create invite link"}
        </button>
      )}
      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}

      <div className="mt-4 pt-3 border-t border-steel/20">
        <button
          type="button"
          onClick={() => setShowEmail((v) => !v)}
          className="font-body text-xs text-steel underline underline-offset-2"
        >
          {showEmail ? "Hide" : "Add or fix their email"}
        </button>
        {showEmail && (
          <form onSubmit={saveEmail} className="mt-2 flex items-center gap-2">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="client@email.com"
              className="flex-1 h-11 min-w-0 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust"
            />
            <button
              type="submit"
              disabled={busy}
              className="h-11 px-4 border border-steel/40 text-chalk font-body text-sm disabled:opacity-50"
            >
              Save
            </button>
          </form>
        )}
        {emailMsg && (
          <p className={`font-body text-xs mt-1.5 ${emailMsg.kind === "error" ? "text-rust" : "text-steel"}`} role="status">
            {emailMsg.text}
          </p>
        )}
      </div>
    </section>
  );
}
