"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { confirmDialog } from "@/components/shared/confirm-dialog";
import type { TeamInvite } from "@/components/org/team-members-panel";
import type { PendingInvitee } from "@/lib/coach-invite-server";

const ROLE_WORD: Record<string, string> = { owner: "Owner", admin: "Admin", coach: "Coach", front_desk: "Front desk" };
const dateOf = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "");

// Everyone who has been invited and has not joined yet. Two kinds, one list: a person invited by a NEW email address (their account is waiting; the link goes out by email and can be sent again, copied or cancelled
// here) and a person who already had an account (an invitation they accept or decline in the app). Each row says who, what role, when it was sent and that it is not accepted yet.
export function InvitationsList({
  groupId,
  canManage,
  invites,
  newInvites,
  busy,
  onResendExisting,
  onCancelExisting,
}: {
  groupId: string;
  canManage: boolean;
  invites: TeamInvite[];
  newInvites: PendingInvitee[];
  busy: string | null;
  onResendExisting: (i: TeamInvite) => void;
  onCancelExisting: (i: TeamInvite) => void;
}) {
  const router = useRouter();
  const [working, setWorking] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "problem"; text: string } | null>(null);
  // A link the browser would not copy for us, shown so it can be selected and copied by hand.
  const [shownLink, setShownLink] = useState<string | null>(null);

  async function post(path: string, profileId: string): Promise<{ ok: boolean; data: any }> {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ groupId, profileId }) });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  }

  async function resend(p: PendingInvitee) {
    setWorking(`resend-${p.profileId}`);
    setMessage(null);
    try {
      const { ok, data } = await post("/api/coaches/invite/resend", p.profileId);
      if (!ok) setMessage({ kind: "problem", text: data.error || "Couldn't send it again. Try again." });
      else if (data.emailed === false) setMessage({ kind: "problem", text: `A new link was made for ${p.name}, but the email did not go out. Use Copy link and send it yourself.` });
      else {
        setMessage({ kind: "ok", text: `Sent again to ${p.email}.` });
        router.refresh();
      }
    } catch {
      setMessage({ kind: "problem", text: "Couldn't send it again. Check your connection and try again." });
    } finally {
      setWorking(null);
    }
  }

  async function copyLink(p: PendingInvitee) {
    setWorking(`copy-${p.profileId}`);
    setMessage(null);
    try {
      const { ok, data } = await post("/api/coaches/invite/link", p.profileId);
      if (!ok || typeof data.link !== "string") {
        setMessage({ kind: "problem", text: data.error || "Couldn't make the link. Try again." });
        return;
      }
      try {
        await navigator.clipboard.writeText(data.link);
        setMessage({ kind: "ok", text: `Link copied. It works once, for ${p.name} only, and replaces any earlier link.` });
      } catch {
        // The browser would not let the page copy: show it so it can be selected by hand.
        setShownLink(data.link);
        setMessage({ kind: "ok", text: "Copy this link and send it to the person. It works once, for them only." });
      }
    } catch {
      setMessage({ kind: "problem", text: "Couldn't make the link. Check your connection and try again." });
    } finally {
      setWorking(null);
    }
  }

  async function cancel(p: PendingInvitee) {
    if (!(await confirmDialog({ message: `Cancel the invitation to ${p.name}? Their link stops working.`, confirmLabel: "Cancel invitation", cancelLabel: "Keep it", destructive: true }))) return;
    setWorking(`cancel-${p.profileId}`);
    setMessage(null);
    try {
      const { ok, data } = await post("/api/coaches/invite/cancel", p.profileId);
      if (!ok) setMessage({ kind: "problem", text: data.error || "Couldn't cancel that invitation. Try again." });
      else router.refresh();
    } catch {
      setMessage({ kind: "problem", text: "Couldn't cancel that invitation. Check your connection and try again." });
    } finally {
      setWorking(null);
    }
  }

  async function copyExisting(i: TeamInvite) {
    const link = `${window.location.origin}/org-invite/${i.id}`;
    try {
      await navigator.clipboard.writeText(link);
      setMessage({ kind: "ok", text: `Link copied. ${i.name} signs in and answers it there.` });
    } catch {
      setShownLink(link);
      setMessage({ kind: "ok", text: "Copy this link and send it to the person." });
    }
  }

  if (invites.length === 0 && newInvites.length === 0) return null;
  const button = "font-body text-xs underline disabled:opacity-40";
  return (
    <div className="mt-6">
      <p className="font-body text-xs text-steel uppercase tracking-wide mb-2">Invitations</p>
      <div className="border border-steel/20 divide-y divide-steel/15">
        {newInvites.map((p) => (
          <div key={p.profileId} className="p-3 flex flex-wrap items-center justify-between gap-2">
            <p className="font-body text-sm">
              {p.name}
              <span className="text-steel text-xs uppercase tracking-wide ml-2">{ROLE_WORD[p.role] ?? p.role}</span>
              <span className="block text-steel text-xs">
                {p.email} · Not accepted yet{p.sentAt ? ` · sent ${dateOf(p.sentAt)}` : ""}
              </span>
            </p>
            {canManage && (
              <div className="flex items-center gap-4">
                <button type="button" onClick={() => resend(p)} disabled={working !== null} className={`${button} text-steel`}>
                  {working === `resend-${p.profileId}` ? "Sending…" : "Send again"}
                </button>
                <button type="button" onClick={() => copyLink(p)} disabled={working !== null} className={`${button} text-steel`}>
                  {working === `copy-${p.profileId}` ? "Making…" : "Copy link"}
                </button>
                <button type="button" onClick={() => cancel(p)} disabled={working !== null} className={`${button} text-rust no-underline`}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        ))}
        {invites.map((i) => {
          const expired = new Date(i.expiresAt) < new Date();
          return (
            <div key={i.id} className="p-3 flex flex-wrap items-center justify-between gap-2">
              <p className="font-body text-sm">
                {i.name}
                <span className="text-steel text-xs uppercase tracking-wide ml-2">{ROLE_WORD[i.role] ?? i.role}</span>
                <span className="block text-steel text-xs">{expired ? "Expired · Not accepted yet" : `Sent · Not accepted yet · open until ${dateOf(i.expiresAt)}`}</span>
              </p>
              {canManage && (
                <div className="flex items-center gap-4">
                  <button type="button" onClick={() => onResendExisting(i)} disabled={busy === `ext-${i.id}`} className={`${button} text-steel`}>
                    Send again
                  </button>
                  <button type="button" onClick={() => copyExisting(i)} className={`${button} text-steel`}>
                    Copy link
                  </button>
                  <button type="button" onClick={() => onCancelExisting(i)} disabled={busy === `cancel-${i.id}`} className={`${button} text-rust no-underline`}>
                    Cancel
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {shownLink && <input readOnly value={shownLink} onFocus={(e) => e.currentTarget.select()} aria-label="Invitation link" className="w-full h-10 mt-2 bg-graphite border border-steel/30 text-chalk px-2.5 font-body text-xs" />}
      {message && (
        <p className={`font-body text-xs mt-2 ${message.kind === "ok" ? "text-positive" : "text-rust"}`} role={message.kind === "ok" ? "status" : "alert"}>
          {message.text}
        </p>
      )}
    </div>
  );
}
