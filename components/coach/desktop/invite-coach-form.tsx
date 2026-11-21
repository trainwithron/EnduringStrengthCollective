"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";

// The invitation whose email did not go out, so Send again and Copy link are offered right in the message (audit, Nov 21). The server hands back one id whatever kind of address it was
// (a new address: the person waiting to accept; an address that already had an account: their in-app invitation), so the answer never tells which; these buttons try the new-address
// calls first (the Invitations list's own routes) and the in-app invitation's calls when that one is not it.
type Unsent = { id: string; name: string } | null;

async function postJson(path: string, body: Record<string, string>): Promise<{ status: number; ok: boolean; data: any }> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, ok: res.ok, data: await res.json().catch(() => ({})) };
}

function UnsentInviteActions({ groupId, id, name }: { groupId: string; id: string; name: string }) {
  const [working, setWorking] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [shownLink, setShownLink] = useState<string | null>(null);
  async function resend() {
    setWorking("resend");
    setMessage(null);
    try {
      let r = await postJson("/api/coaches/invite/resend", { groupId, profileId: id });
      if (r.status === 404) r = await postJson("/api/org-invites/resend", { inviteId: id });
      if (!r.ok) setMessage({ ok: false, text: r.data.error || "Couldn't send it again. Try again." });
      else if (r.data.emailed === false) setMessage({ ok: false, text: `The email to ${name} did not go out again. Use Copy link and send it yourself.` });
      else setMessage({ ok: true, text: `Sent again to ${name}.` });
    } catch {
      setMessage({ ok: false, text: "Couldn't send it again. Check your connection and try again." });
    } finally {
      setWorking(null);
    }
  }
  async function copy() {
    setWorking("copy");
    setMessage(null);
    setShownLink(null);
    try {
      const r = await postJson("/api/coaches/invite/link", { groupId, profileId: id });
      const link = r.ok && typeof r.data.link === "string" ? r.data.link : r.status === 404 ? `${window.location.origin}/org-invite/${id}` : null;
      if (!link) {
        setMessage({ ok: false, text: r.data.error || "Couldn't get the link. Try again." });
        return;
      }
      try {
        await navigator.clipboard.writeText(link);
        setMessage({ ok: true, text: `Link copied. Send it to ${name}.` });
      } catch {
        setShownLink(link);
        setMessage({ ok: true, text: "Copy this link and send it to the person." });
      }
    } catch {
      setMessage({ ok: false, text: "Couldn't get the link. Check your connection and try again." });
    } finally {
      setWorking(null);
    }
  }
  const button = "min-h-11 font-body text-sm font-semibold text-rust-ink disabled:opacity-40";
  return (
    <div className="mt-2">
      <div className="flex items-center gap-4">
        <button type="button" onClick={resend} disabled={working !== null} className={button}>
          {working === "resend" ? "Sending…" : "Send again"}
        </button>
        <button type="button" onClick={copy} disabled={working !== null} className={button}>
          {working === "copy" ? "Getting…" : "Copy link"}
        </button>
      </div>
      {shownLink && <input readOnly value={shownLink} onFocus={(e) => e.currentTarget.select()} aria-label="Invitation link" className="w-full h-10 bg-graphite border border-steel/30 text-chalk px-2.5 font-body text-xs" />}
      {message && (
        <p className={`font-body text-xs mt-1 ${message.ok ? "text-positive" : "text-rust-ink"}`} role={message.ok ? "status" : "alert"}>
          {message.text}
        </p>
      )}
    </div>
  );
}

export function InviteCoachForm({ groupId }: { groupId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [orgRole, setOrgRole] = useState<"coach" | "admin" | "front_desk">("coach");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [emailed, setEmailed] = useState(true);
  const [unsent, setUnsent] = useState<Unsent>(null);

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

      setEmailed(data.emailed !== false);
      setUnsent(data.emailed === false && typeof data.unsentId === "string" ? { id: data.unsentId, name: fullName.trim() } : null);
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
        className="inline-flex items-center gap-2 h-11 px-4 border border-rust text-rust-ink font-body text-sm font-medium active:bg-rust active:text-graphite transition-colors"
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
          {emailed ? (
            <p className="font-body text-sm text-positive">
              If that person has no open invitation, we sent one, and they join once they accept. Check Invitations on the Team page for anything already open: you can send it again, copy the link or cancel it there.
            </p>
          ) : (
            <div>
              <p className="font-body text-sm text-rust-ink" role="alert">
                {unsent
                  ? "The invitation was made, but the email did not go out. Send it again, or copy the link and send it yourself."
                  : "The invitation was made, but the email did not go out. Open Invitations on the Team page and choose Send again, or Copy link and send it yourself."}
              </p>
              {unsent && <UnsentInviteActions groupId={groupId} id={unsent.id} name={unsent.name} />}
            </div>
          )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="font-body text-xs text-rust-ink mt-3"
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
              onChange={(e) => setOrgRole(e.target.value as "coach" | "admin" | "front_desk")}
              className="w-full h-10 mt-1 bg-graphite border border-steel/30 text-chalk px-2.5 font-body text-sm focus:outline-none focus:border-rust"
            >
              <option value="coach">Coach</option>
              <option value="admin">Admin</option>
              <option value="front_desk">Front desk (check-in only)</option>
            </select>
            <p className="font-body text-xs text-steel mt-1">
              {orgRole === "front_desk"
                ? "Front desk staff check clients in on the front-desk screen and can see nothing else: no health answers, programs, messages or reports."
                : "Admins and coaches have the same access today — this just records their level for when permission tiers are built out."}
            </p>
          </div>
          {error && (
            <p className="font-body text-xs text-rust-ink" role="alert">
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
