"use client";

import { useState } from "react";
import type { TeamInvite } from "@/components/org/team-members-panel";
import { PendingInviteActions } from "@/components/org/pending-invite-actions";
import type { PendingInvitee } from "@/lib/coach-invite-server";

const ROLE_WORD: Record<string, string> = { owner: "Owner", admin: "Admin", coach: "Coach", front_desk: "Front desk" };
// A link made by an invitation stops working after about an hour, so one sent longer ago than that is likely dead.
const linkIsOld = (iso: string | null) => !!iso && Date.now() - new Date(iso).getTime() > 3600 * 1000;
const dateOf = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "");

// Everyone who has been invited and has not joined yet. Two kinds, one list: a person invited by a NEW email address (their account is waiting; the link goes out by email and can be sent again, copied or cancelled
// here, with the same buttons as in the Coaching staff lists) and a person who already had an account (an invitation they accept or decline in the app). Each row says who, what role, when it was sent and that it is
// not accepted yet.
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
  const [message, setMessage] = useState<string | null>(null);
  // A link the browser would not copy for us, shown under its own row; cleared by the next action.
  const [shownLink, setShownLink] = useState<{ key: string; link: string } | null>(null);

  async function copyExisting(i: TeamInvite) {
    setShownLink(null);
    setMessage(null);
    const link = `${window.location.origin}/org-invite/${i.id}`;
    try {
      await navigator.clipboard.writeText(link);
      setMessage(`Link copied. ${i.name} signs in and answers it there.`);
    } catch {
      setShownLink({ key: i.id, link });
      setMessage("Copy this link and send it to the person.");
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
              {linkIsOld(p.sentAt) && <span className="block text-steel text-xs">The link may have expired. Use Send again.</span>}
            </p>
            {canManage && <PendingInviteActions groupId={groupId} profileId={p.profileId} name={p.name} email={p.email} />}
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
              {shownLink?.key === i.id && <input readOnly value={shownLink.link} onFocus={(e) => e.currentTarget.select()} aria-label="Invitation link" className="basis-full w-full h-10 bg-graphite border border-steel/30 text-chalk px-2.5 font-body text-xs" />}
            </div>
          );
        })}
      </div>
      {message && (
        <p className="font-body text-xs mt-2 text-positive" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
