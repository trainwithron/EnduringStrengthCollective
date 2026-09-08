"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";

export function AddClientButton({ groupId }: { groupId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/clients/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groupId, fullName, email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't add this client.");

      setSuccess(true);
      setFullName("");
      setEmail("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add this client.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setSuccess(false);
        }}
        className="inline-flex items-center gap-2 h-11 px-4 border border-rust text-rust font-body text-sm font-medium active:bg-rust active:text-graphite transition-colors"
      >
        <UserPlus className="w-4 h-4" strokeWidth={2.5} />
        Add client
      </button>
    );
  }

  return (
    <div className="border border-steel/30 p-4 max-w-sm bg-surface">
      <p className="font-body text-xs text-steel uppercase tracking-wide mb-3">
        Add a client before they accept an invite
      </p>
      {success ? (
        <div>
          <p className="font-body text-sm text-positive">
            Client added — they&apos;ll get an email to set their password.
            You can already assign a program to them.
          </p>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="font-body text-xs text-rust mt-3"
          >
            Done
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
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
          {error && (
            <p className="font-body text-xs text-rust" role="alert">
              {error}
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
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={submitting}
              className="font-body text-xs text-steel disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
