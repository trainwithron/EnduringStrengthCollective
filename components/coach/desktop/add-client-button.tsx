"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";

function randomCode(length = 10) {
  // Excludes visually ambiguous characters (0/O, 1/l/I) since this gets
  // read aloud or retyped as often as it gets clicked.
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

type Mode = "link" | "direct";

// One "Add client" entry point covering both ways to bring a client in —
// a shareable invite link (they sign themselves up whenever they get to
// it) or adding them directly by name/email (a real account exists
// immediately, so a coach can start building their program before they've
// ever logged in). Previously two separate buttons; merged since they're
// really one decision ("how do you want to add this client?"), not two
// different features.
export function AddClientButton({ groupId, createdBy }: { groupId: string; createdBy: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("link");

  // Invite-link mode state
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  // Add-directly mode state
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [directError, setDirectError] = useState<string | null>(null);
  const [directSuccess, setDirectSuccess] = useState(false);

  async function handleGenerateLink() {
    setGenerating(true);
    setLinkError(null);

    const supabase = createBrowserClient();
    const code = randomCode();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { error: insertError } = await supabase.from("group_invites").insert({
      group_id: groupId,
      code,
      role: "athlete",
      created_by: createdBy,
      expires_at: expiresAt,
    });

    if (insertError) {
      setLinkError("Couldn't create an invite link.");
      setGenerating(false);
      return;
    }

    setLink(`${window.location.origin}/invite/${code}`);
    setGenerating(false);
  }

  async function handleCopy() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleDirectSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setDirectError(null);

    try {
      const res = await fetch("/api/clients/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groupId, fullName, email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't add this client.");

      setDirectSuccess(true);
      setFullName("");
      setEmail("");
      router.refresh();
    } catch (err) {
      setDirectError(err instanceof Error ? err.message : "Couldn't add this client.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    setOpen(false);
    setLink(null);
    setDirectSuccess(false);
    setMode("link");
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 h-11 px-4 border border-rust text-rust font-body text-sm font-medium active:bg-rust active:text-graphite transition-colors"
      >
        <UserPlus className="w-4 h-4" strokeWidth={2.5} />
        Add client
      </button>
    );
  }

  return (
    <div className="border border-steel/30 p-4 max-w-sm bg-surface">
      <div className="flex items-center gap-1 mb-3">
        {(["link", "direct"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`h-8 px-3 font-body text-xs border ${
              mode === m ? "bg-rust text-graphite border-rust" : "border-steel/30 text-steel"
            }`}
          >
            {m === "link" ? "Invite link" : "Add directly"}
          </button>
        ))}
      </div>

      {mode === "link" ? (
        link ? (
          <div>
            <p className="font-body text-xs text-steel mb-2">Invite link &middot; expires in 7 days</p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={link}
                onFocus={(e) => e.target.select()}
                className="flex-1 h-10 min-w-0 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs focus:outline-none"
              />
              <button
                type="button"
                onClick={handleCopy}
                className="h-10 px-3 border border-rust text-rust font-body text-xs shrink-0"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <button type="button" onClick={handleClose} className="font-body text-xs text-steel mt-3">
              Done
            </button>
          </div>
        ) : (
          <div>
            <p className="font-body text-xs text-steel mb-3">
              They sign up themselves whenever they get to it.
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleGenerateLink}
                disabled={generating}
                className="h-9 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
              >
                {generating ? "Generating…" : "Generate link"}
              </button>
              <button type="button" onClick={handleClose} className="font-body text-xs text-steel">
                Cancel
              </button>
            </div>
            {linkError && <p className="font-body text-xs text-rust mt-2">{linkError}</p>}
          </div>
        )
      ) : directSuccess ? (
        <div>
          <p className="font-body text-sm text-positive">
            Client added — they&apos;ll get an email to set their password. You can already assign
            a program to them.
          </p>
          <button type="button" onClick={handleClose} className="font-body text-xs text-rust mt-3">
            Done
          </button>
        </div>
      ) : (
        <form onSubmit={handleDirectSubmit} className="space-y-3">
          <p className="font-body text-xs text-steel">
            A real account exists immediately — build/assign a program before they&apos;ve ever
            logged in.
          </p>
          <div>
            <label htmlFor="client-name" className="font-body text-xs text-steel">
              Full name
            </label>
            <input
              id="client-name"
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full h-10 mt-1 bg-graphite border border-steel/30 text-chalk px-2.5 font-body text-sm focus:outline-none focus:border-rust"
            />
          </div>
          <div>
            <label htmlFor="client-email" className="font-body text-xs text-steel">
              Email
            </label>
            <input
              id="client-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full h-10 mt-1 bg-graphite border border-steel/30 text-chalk px-2.5 font-body text-sm focus:outline-none focus:border-rust"
            />
          </div>
          {directError && (
            <p className="font-body text-xs text-rust" role="alert">
              {directError}
            </p>
          )}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="h-9 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
            >
              {submitting ? "Adding…" : "Add client"}
            </button>
            <button type="button" onClick={handleClose} disabled={submitting} className="font-body text-xs text-steel disabled:opacity-40">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
