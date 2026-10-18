"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { confirmDialog } from "@/components/shared/confirm-dialog";
import { InvitationsList } from "@/components/org/invitations-list";
import type { PendingInvitee } from "@/lib/coach-invite-server";

export interface TeamMember {
  profileId: string;
  fullName: string;
  role: "owner" | "admin" | "coach" | string;
  clients: number;
  // Clients in groups only this member coaches: removing them needs somebody to take over.
  soleClients: number;
  // Left the team (or the team closed) but still coaches clients who are private from it, and has not yet chosen what to do (migration 0396).
  leaving?: boolean;
  // Let go by the organization (shown as "Let go" instead of "Leaving").
  fired?: boolean;
  // Whether this owner or admin can read the clients' health screening answers (the owner grants it; migration 0399). Everyone else on the team sees only "done" or "needs attention".
  healthAccess?: boolean;
}

export interface TeamInvite {
  id: string;
  name: string;
  role: string;
  expiresAt: string;
}

// What happens to a coach who still has clients that are private from the organization (a coach without any is simply removed).
const LEAVING_NOTE = {
  fired: (name: string) => `${name} then loses coaching access to those clients right away and cannot start their own account here.`,
  good: (name: string) => `${name} then gets seven days to choose whether to start their own account or export everything.`,
};
const ROLE_WORD: Record<string, string> = { owner: "Owner", admin: "Admin", coach: "Coach", front_desk: "Front desk" };

// The people in the organization (owner and admins can change roles, remove a member and hand over their clients, cancel or extend an invitation), and for the owner, ending the team. Every rule is in the
// database functions (migration 0391); this only asks and shows their plain-word refusals.
export function TeamMembersPanel({
  groupId,
  organizationId,
  organizationName,
  me,
  myRole,
  members,
  invites,
  newInvites = [],
}: {
  groupId: string;
  organizationId: string;
  organizationName: string;
  me: string;
  myRole: string;
  members: TeamMember[];
  invites: TeamInvite[];
  // People invited by a new email address who have not accepted yet (their account is waiting).
  newInvites?: PendingInvitee[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [handTo, setHandTo] = useState("");
  // The one question when removing a coach: let go ("fired") or leaving on good terms ("good").
  const [kind, setKind] = useState<"" | "fired" | "good">("");
  const [closing, setClosing] = useState(false);
  const [typedName, setTypedName] = useState("");
  const isOwner = myRole === "owner";
  const isOwnerOrAdmin = isOwner || myRole === "admin";
  const [announcement, setAnnouncement] = useState("");
  const [announceNote, setAnnounceNote] = useState<string | null>(null);

  async function announce() {
    const text = announcement.trim();
    if (!text) return;
    setBusy("announce");
    setAnnounceNote(null);
    try {
      const res = await fetch("/api/org/announce", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ organizationId, message: text }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAnnounceNote(data.error || "Couldn't send it. Try again.");
      } else {
        setAnnouncement("");
        setAnnounceNote(data.failed > 0 ? `Sent to ${data.sent}; ${data.failed} could not be reached.` : `Sent to ${data.sent} coach${data.sent === 1 ? "" : "es"}.`);
      }
    } catch {
      setAnnounceNote("Couldn't send it. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  const db = () => createBrowserClient({ crossOrg: true });

  async function run(key: string, call: () => PromiseLike<{ error: { message: string } | null }>, after?: () => void) {
    setBusy(key);
    setError(null);
    const { error: rpcError } = await call();
    setBusy(null);
    if (rpcError) {
      setError(rpcError.message);
      return false;
    }
    after?.();
    router.refresh();
    return true;
  }

  // The owner lets an owner or admin read the clients' health screening answers, or takes it back.
  async function setHealthAccess(m: TeamMember, on: boolean) {
    await run(`health-${m.profileId}`, () => db().rpc("set_health_access", { p_org: organizationId, p_profile: m.profileId, p_on: on }));
  }

  async function changeRole(m: TeamMember) {
    const next = m.role === "admin" ? "coach" : "admin";
    await run(`role-${m.profileId}`, () => db().rpc("set_org_member_role", { p_org: organizationId, p_profile: m.profileId, p_role: next }));
  }

  async function remove(m: TeamMember) {
    const needsHandOver = m.soleClients > 0;
    if (needsHandOver && !handTo) {
      setError(`Choose who takes over ${m.fullName}'s ${m.soleClients} client${m.soleClients === 1 ? "" : "s"} first.`);
      return;
    }
    if (!kind) {
      setError(`Say whether ${m.fullName} is being let go or is leaving on good terms.`);
      return;
    }
    const takeover = members.find((x) => x.profileId === handTo && !x.leaving)?.fullName;
    const message = needsHandOver
      ? `Remove ${m.fullName} from ${organizationName}? They lose access to every client here right away. Their ${m.soleClients} client${m.soleClients === 1 ? "" : "s"} stay${m.soleClients === 1 ? "s" : ""} with ${organizationName} and ${takeover} takes over, with all history, programs and credits. If a client keeps their records private from the organization, that client stays with ${m.fullName}. ${LEAVING_NOTE[kind || "good"](m.fullName)}`
      : `Remove ${m.fullName} from ${organizationName}? They lose access to every client here right away. If a client keeps their records private from the organization, that client stays with ${m.fullName}. ${LEAVING_NOTE[kind || "good"](m.fullName)}`;
    if (!(await confirmDialog({ message, confirmLabel: "Remove", destructive: true }))) return;
    await run(`remove-${m.profileId}`, () => db().rpc("remove_org_member", { p_org: organizationId, p_profile: m.profileId, p_hand_to: needsHandOver ? handTo : null, p_fired: kind === "fired" }), () => {
      setRemoving(null);
      setHandTo("");
      setKind("");
    });
  }

  // Sends it again: fourteen more days, and the person is told again (a notice and an email).
  async function resend(i: TeamInvite) {
    setBusy(`ext-${i.id}`);
    setError(null);
    try {
      const res = await fetch("/api/org-invites/resend", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ inviteId: i.id }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error || "Couldn't send it again. Try again.");
      else router.refresh();
    } catch {
      setError("Couldn't send it again. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }
  async function cancel(i: TeamInvite) {
    if (!(await confirmDialog({ message: `Cancel the invitation to ${i.name}?`, confirmLabel: "Cancel invitation", cancelLabel: "Keep it", destructive: true }))) return;
    await run(`cancel-${i.id}`, () => db().rpc("cancel_org_invite", { p_invite: i.id }));
  }

  async function closeTeam() {
    if (typedName.trim().toLowerCase() !== organizationName.trim().toLowerCase()) {
      setError(`Type ${organizationName} exactly to close it.`);
      return;
    }
    await run("close", () => db().rpc("close_organization", { p_org: organizationId }), () => {
      setClosing(false);
      setTypedName("");
    });
  }

  return (
    <div className="mb-8">
      {isOwnerOrAdmin && (
        <div className="mb-6 max-w-xl">
          <label htmlFor="announce" className="font-body text-xs text-steel uppercase tracking-wide">
            Message your coaches
          </label>
          <textarea
            id="announce"
            rows={3}
            maxLength={500}
            value={announcement}
            onChange={(e) => setAnnouncement(e.target.value)}
            placeholder="A short note every coach on the team will see in their notifications."
            className="w-full mt-1 bg-graphite border border-steel/30 text-chalk px-2.5 py-2 font-body text-base sm:text-sm focus:outline-none focus:border-rust"
          />
          <div className="flex items-center gap-3 mt-2">
            <button type="button" onClick={announce} disabled={busy === "announce" || !announcement.trim()} className="h-11 px-4 border border-rust text-rust font-body text-sm font-medium disabled:opacity-40">
              {busy === "announce" ? "Sending…" : "Send to the team"}
            </button>
            {announceNote && (
              <p className="font-body text-xs text-steel" role="status">
                {announceNote}
              </p>
            )}
          </div>
          <p className="font-body text-xs mt-3">
            <Link href={`/groups/${groupId}/team-activity`} className="text-rust">
              Coach activity and payroll estimate &rarr;
            </Link>
          </p>
        </div>
      )}
      <p className="font-body text-xs text-steel uppercase tracking-wide mb-2">Coaches</p>
      <div className="border border-steel/20 divide-y divide-steel/15">
        {members.map((m) => {
          const canTouch = isOwnerOrAdmin && m.role !== "owner" && m.profileId !== me && (isOwner || m.role !== "admin") && !m.leaving;
          const isRemoving = removing === m.profileId;
          // someone who is leaving cannot take over a gym's clients
          const others = members.filter((x) => x.profileId !== m.profileId && !x.leaving);
          return (
            <div key={m.profileId} className="p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-body text-sm">
                  {m.fullName}
                  {m.profileId === me ? <span className="text-steel"> (you)</span> : null}
                  <span className="text-steel text-xs uppercase tracking-wide ml-2">{ROLE_WORD[m.role] ?? m.role}</span>
                  {m.leaving ? <span className="text-rust text-xs uppercase tracking-wide ml-2">{m.fired ? "Let go" : "Leaving"}</span> : null}
                </p>
                {isOwnerOrAdmin && (
                  <p className="font-body text-xs text-steel">
                    {m.clients} client{m.clients === 1 ? "" : "s"}
                  </p>
                )}
              </div>
              {isOwner && (m.role === "owner" || m.role === "admin") && !m.leaving && (
                <label className="flex items-center gap-2 min-h-11 mt-1 font-body text-xs text-steel">
                  <input
                    type="checkbox"
                    checked={!!m.healthAccess}
                    disabled={busy === `health-${m.profileId}`}
                    onChange={(e) => setHealthAccess(m, e.target.checked)}
                  />
                  Can read clients&apos; health screening answers
                </label>
              )}
              {canTouch && !isRemoving && (
                <div className="flex flex-wrap items-center gap-4 mt-2">
                  {isOwner && (
                    <button type="button" onClick={() => changeRole(m)} disabled={busy === `role-${m.profileId}`} className="font-body text-xs text-steel underline disabled:opacity-40">
                      {m.role === "admin" ? "Make a coach" : "Make an admin"}
                    </button>
                  )}
                  <button type="button" onClick={() => { setRemoving(m.profileId); setError(null); setHandTo(""); setKind(""); }} className="font-body text-xs text-rust">
                    Remove
                  </button>
                </div>
              )}
              {canTouch && isRemoving && (
                <div className="mt-3 border border-steel/20 p-3">
                  {m.soleClients > 0 ? (
                    <>
                      <label htmlFor={`hand-${m.profileId}`} className="font-body text-xs text-steel">
                        {m.fullName} is the only coach of {m.soleClients} client{m.soleClients === 1 ? "" : "s"}. Who takes over?
                      </label>
                      <select id={`hand-${m.profileId}`} value={handTo} onChange={(e) => setHandTo(e.target.value)} className="w-full h-11 mt-1 bg-graphite border border-steel/30 text-chalk px-2.5 font-body text-base sm:text-sm">
                        <option value="">Choose a coach…</option>
                        {others.map((o) => (
                          <option key={o.profileId} value={o.profileId}>
                            {o.fullName}
                          </option>
                        ))}
                      </select>
                    </>
                  ) : (
                    <p className="font-body text-xs text-steel">{m.fullName} has no clients that need a new coach.</p>
                  )}
                  <fieldset className="mt-3">
                    <legend className="font-body text-xs text-steel">Why are they going?</legend>
                    <label className="flex items-center gap-2 min-h-11 font-body text-sm">
                      <input type="radio" name={`kind-${m.profileId}`} checked={kind === "good"} onChange={() => setKind("good")} />
                      They are leaving on their own / on good terms
                    </label>
                    <label className="flex items-center gap-2 min-h-11 font-body text-sm">
                      <input type="radio" name={`kind-${m.profileId}`} checked={kind === "fired"} onChange={() => setKind("fired")} />
                      They are being let go
                    </label>
                  </fieldset>
                  <div className="flex items-center gap-3 mt-3">
                    <button type="button" onClick={() => remove(m)} disabled={busy === `remove-${m.profileId}`} className="h-11 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
                      {busy === `remove-${m.profileId}` ? "Removing…" : "Remove"}
                    </button>
                    <button type="button" onClick={() => setRemoving(null)} className="font-body text-xs text-steel">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <InvitationsList groupId={groupId} canManage={isOwnerOrAdmin} invites={invites} newInvites={newInvites} busy={busy} onResendExisting={resend} onCancelExisting={cancel} />

      {error && (
        <p className="font-body text-xs text-rust mt-3" role="alert">
          {error}
        </p>
      )}

      {isOwner && members.length > 1 && (
        <div className="mt-8 border-t border-steel/20 pt-4">
          {!closing ? (
            <button type="button" onClick={() => { setClosing(true); setError(null); }} className="font-body text-xs text-rust">
              Close this organization
            </button>
          ) : (
            <div className="max-w-md">
              <p className="font-body text-sm text-chalk">
                Closing {organizationName} ends the team. Every other coach leaves. The clients you can see move to you or stay with the coach who has them; a client who keeps their records private from the team stays with their coach, who then chooses what to do next. Groups with several coaches stay with you. Download your data first. Billing is not changed here.
              </p>
              <label htmlFor="close-name" className="font-body text-xs text-steel block mt-3">
                Type {organizationName} to confirm
              </label>
              <input id="close-name" value={typedName} onChange={(e) => setTypedName(e.target.value)} className="w-full h-11 mt-1 bg-graphite border border-steel/30 text-chalk px-2.5 font-body text-base sm:text-sm" />
              <div className="flex items-center gap-3 mt-3">
                <button type="button" onClick={closeTeam} disabled={busy === "close"} className="h-11 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
                  {busy === "close" ? "Closing…" : "Close it"}
                </button>
                <button type="button" onClick={() => { setClosing(false); setTypedName(""); }} className="font-body text-xs text-steel">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
