"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";

export function InviteCoachForm({ groupId }: { groupId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [orgRole, setOrgRole] = useState<"coach" | "admin">("coach");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/coaches/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groupId, fullName, email, orgRole }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't invite this coach.");

      setSuccess(true);
      setFullName("");
      setEmail("");
      setOrgRole("coach");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't invite this coach.");
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
        Invite coach
      </button>
    );
  }

  return (
    <div className="border border-steel/30 p-4 max-w-sm bg-surface">
      <p className="font-body text-xs text-steel uppercase tracking-wide mb-3">
        Invite a coach into your organization
      </p>
      {success ? (
        <div>
          <p className="font-body text-sm text-positive">
            Invite sent — they&apos;ll get an email to set their password and join as a coach.
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
            <label htmlFor="coach-name" className="font-body text-xs text-steel">
              Full name
            </label>
            <input
              id="coach-name"
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full h-10 mt-1 bg-graphite border border-steel/30 text-chalk px-2.5 font-body text-sm focus:outline-none focus:border-rust"
            />
          </div>
          <div>
            <label htmlFor="coach-email" className="font-body text-xs text-steel">
              Email
            </label>
            <input
              id="coach-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full h-10 mt-1 bg-graphite border border-steel/30 text-chalk px-2.5 font-body text-sm focus:outline-none focus:border-rust"
            />
          </div>
          <div>
            <label htmlFor="coach-role" className="font-body text-xs text-steel">
              Permission level
            </label>
            <select
              id="coach-role"
              value={orgRole}
              onChange={(e) => setOrgRole(e.target.value as "coach" | "admin")}
              className="w-full h-10 mt-1 bg-graphite border border-steel/30 text-chalk px-2.5 font-body text-sm focus:outline-none focus:border-rust"
            >
              <option value="coach">Coach</option>
              <option value="admin">Admin</option>
            </select>
            <p className="font-body text-[11px] text-steel mt-1">
              Admins and coaches have the same access today — this just records their level for
              when permission tiers are built out.
            </p>
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
              {submitting ? "Inviting…" : "Send invite"}
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
