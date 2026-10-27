"use client";

import { confirmDialog } from "@/components/shared/confirm-dialog";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { appOriginBrowser } from "@/lib/app-url";
import { linkLifetimeText, NEVER_EXPIRES_NOTE, planInviteLinks, SINGLE_LINK_NOTE, type InviteLinkRow } from "@/lib/invite-link-plan";
import { inviteUrl, joinPoster } from "@/lib/qr-poster";
import { QrPosterButton } from "@/components/coach/qr-poster-button";

export type GroupInviteRow = InviteLinkRow;

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// A team or social group's invite link, tucked into one collapsed line (it used to be a wall of every link ever made at the top of the page). A group has ONE
// current link: a new link replaces the old one, it lasts 7 days and can be extended, or never expires when the coach chooses (for a poster). Its QR code opens from here.
// Any other working link (older ones) is listed only so it can be cancelled.
export function GroupInvitesPanel({ groupId, groupName, coachName, invites }: { groupId: string; groupName: string; coachName: string | null; invites: GroupInviteRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [neverExpires, setNeverExpires] = useState(false);

  const plan = planInviteLinks(invites);
  const summary = plan.current ? linkLifetimeText(plan.current) : "no link yet";

  async function call(body: Record<string, unknown>, key: string, confirmText?: string) {
    if (confirmText && !await confirmDialog(confirmText)) return;
    setError(null);
    setBusy(key);
    try {
      const res = await fetch("/api/invites/group", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "That didn't work. Try again.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    if (!plan.current) return;
    try {
      await navigator.clipboard.writeText(inviteUrl(appOriginBrowser(), plan.current.code));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy. Select the link and copy it by hand.");
    }
  }

  return (
    <section className="mb-6 border border-steel/20">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="w-full flex items-center justify-between gap-3 px-4 min-h-[44px] text-left">
        <span className="font-body text-sm text-chalk">
          Invite link to {groupName}: <span className="text-steel">{summary}</span>
        </span>
        <span aria-hidden="true" className="text-steel">
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && (
        <div className="border-t border-steel/15 px-4 py-3">
          <p className="font-body text-xs text-steel">Anyone who joins with this link is put in {groupName}. To bring in a one-on-one client, use Add client.</p>
          {plan.current ? (
            <div className="mt-3">
              <p className="font-body text-xs text-steel">
                Made {formatDay(plan.current.createdAt)} &middot;{" "}
                {plan.current.neverExpires ? "Never expires" : `expires in ${plan.current.daysLeft} ${plan.current.daysLeft === 1 ? "day" : "days"}`}
              </p>
              <div className="flex items-center gap-2 mt-1.5">
                <input aria-label="Invite link" readOnly value={inviteUrl(appOriginBrowser(), plan.current.code)} onFocus={(e) => e.target.select()} className="flex-1 min-w-0 h-10 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs focus:outline-none" />
                <button type="button" onClick={copy} className="h-10 px-3 border border-rust text-rust font-body text-sm shrink-0">
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <div className="mt-2">
                <QrPosterButton url={inviteUrl(appOriginBrowser(), plan.current.code)} content={joinPoster(groupName, coachName)} />
              </div>
              <div className="flex flex-wrap items-center gap-3 mt-2">
                {plan.current.neverExpires ? (
                  <button type="button" onClick={() => call({ action: "extend", inviteId: plan.current!.id }, "extend")} disabled={busy !== null} className="font-body text-sm text-chalk underline underline-offset-2 disabled:opacity-40">
                    Expire in 7 days instead
                  </button>
                ) : (
                  <>
                    <button type="button" onClick={() => call({ action: "extend", inviteId: plan.current!.id }, "extend")} disabled={busy !== null} className="font-body text-sm text-chalk underline underline-offset-2 disabled:opacity-40">
                      Extend 7 days
                    </button>
                    <button type="button" onClick={() => call({ action: "extend", inviteId: plan.current!.id, neverExpires: true }, "never")} disabled={busy !== null} className="font-body text-sm text-chalk underline underline-offset-2 disabled:opacity-40">
                      Never expires
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => call({ action: "revoke", inviteId: plan.current!.id }, "cancel", "Cancel this link? Anyone who has it will no longer be able to join with it.")}
                  disabled={busy !== null}
                  className="font-body text-sm text-steel underline underline-offset-2 disabled:opacity-40"
                >
                  Cancel link
                </button>
              </div>
            </div>
          ) : (
            <p className="font-body text-sm text-steel mt-3">No working link right now.</p>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3">
            <button
              type="button"
              onClick={() => call({ action: "create", groupId, neverExpires }, "create")}
              disabled={busy !== null}
              className="h-10 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-50"
            >
              {busy === "create" ? "Making…" : plan.current ? "New link" : "Make a link"}
            </button>
            <label className="min-h-11 inline-flex items-center gap-2 font-body text-sm text-chalk">
              <input type="checkbox" checked={neverExpires} onChange={(e) => setNeverExpires(e.target.checked)} className="w-4 h-4 accent-rust" />
              Never expires
            </label>
          </div>
          <p className="font-body text-xs text-steel mt-1.5">{neverExpires ? NEVER_EXPIRES_NOTE : "Works for 7 days."}{plan.current ? ` ${SINGLE_LINK_NOTE}` : ""}</p>

          {plan.extra.length > 0 && (
            <div className="mt-4 border-t border-steel/15 pt-3">
              <p className="font-body text-xs text-steel mb-1">Older links that still work. Cancel any you don&apos;t need.</p>
              <ul className="divide-y divide-steel/15">
                {plan.extra.map((l) => (
                  <li key={l.id} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-body text-sm text-chalk">Made {formatDay(l.createdAt)}</span>
                    <span className={`font-body text-xs ${l.neverExpires ? "text-rust" : "text-steel"}`}>{l.neverExpires ? "never expires: cancel it" : `expires ${formatDay(l.expiresAt!)}`}</span>
                    <button
                      type="button"
                      onClick={() => call({ action: "revoke", inviteId: l.id }, `x-${l.id}`, "Cancel this link? Anyone who has it will no longer be able to join with it.")}
                      disabled={busy !== null}
                      className="ml-auto h-9 px-3 border border-steel/40 text-chalk font-body text-sm disabled:opacity-40"
                    >
                      Cancel link
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {error && (
            <p className="font-body text-xs text-rust mt-2" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
