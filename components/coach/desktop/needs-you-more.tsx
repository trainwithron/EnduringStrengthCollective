"use client";

import { useState } from "react";
import Link from "next/link";
import { FEWER_LABEL, moreLabel, type NeedsYouItem } from "@/lib/needs-you";
import { QuietClientNudgeButton } from "@/components/coach/quiet-client-nudge-button";
import { EmailClaimLinkButton } from "@/components/coach/email-claim-link-button";
import { DraftMessageLink } from "@/components/messages/draft-message-link";
import { announceNeedsYouMore } from "@/components/coach/desktop/needs-stack-fold";

// "Send link" on a Needs you item for a client who has not signed in (audit, Nov 21): emails their sign-in link right from Home, with the same confirm as the profile's button when a working
// link already exists. When the email cannot go, the link comes back to copy, and "Sign-in options" opens the profile's section with every other way.
export function NeedsYouSendLink({ groupId, athleteId, optionsHref, compact = false }: { groupId: string; athleteId: string; optionsHref: string; compact?: boolean }) {
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // the link is in the box below to copy by hand
    }
  }
  return (
    <div className={compact ? "flex flex-wrap items-center gap-x-3" : "mt-auto space-y-1"} data-needs-you-send-link>
      <EmailClaimLinkButton
        groupId={groupId}
        athleteId={athleteId}
        label="Send link"
        onLink={setLink}
        className={
          compact
            ? "min-h-11 font-body text-sm font-semibold text-rust-ink disabled:opacity-50"
            : "inline-flex items-center justify-center h-11 px-5 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-50"
        }
      />
      {link && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={copy} className="min-h-11 font-body text-sm font-semibold text-rust-ink">
            {copied ? "Copied" : "Copy link"}
          </button>
          <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Sign-in link" className="flex-1 min-w-0 h-11 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs" />
        </div>
      )}
      <Link prefetch={false} href={optionsHref} className="inline-flex items-center min-h-11 font-body text-[13px] text-steel underline underline-offset-2 hover:text-chalk">
        Sign-in options
      </Link>
    </div>
  );
}

// The one action of a Needs you item, small, for the list "N more" opens: the in-app message for a quiet-in-chat client, the sign-in email for one who has not signed in, else a link.
function ItemAction({ item, viewer }: { item: NeedsYouItem; viewer: { id: string; name: string } | null }) {
  if (item.nudge && viewer) {
    return <QuietClientNudgeButton athleteId={item.nudge.athleteId} athleteFirstName={item.nudge.firstName} groupId={item.nudge.groupId} coachId={viewer.id} coachName={viewer.name} />;
  }
  if (item.draft) {
    return (
      <DraftMessageLink threadHref={item.draft.threadHref} draft={item.draft.text} className="inline-flex items-center min-h-11 font-body text-sm font-semibold text-rust-ink hover:underline underline-offset-2">
        {item.button}
      </DraftMessageLink>
    );
  }
  if (item.claimLink) return <NeedsYouSendLink groupId={item.claimLink.groupId} athleteId={item.claimLink.athleteId} optionsHref={item.href} compact />;
  return (
    <Link prefetch={false} href={item.href} className="inline-flex items-center min-h-11 font-body text-sm font-semibold text-rust-ink hover:underline underline-offset-2">
      {item.button}
    </Link>
  );
}

// "N more" under the three cards (audit, Nov 21): it opens the rest of the ranked list right here, compact, every item with its own button (unread messages, weekly check-ins, goal talks,
// injuries, clients not signed in, low readiness, fatigue, missed habits and the rest), and closes again. It used to jump down Home to panels where several of these never appear.
export function NeedsYouMore({ items, viewer = null }: { items: NeedsYouItem[]; viewer?: { id: string; name: string } | null }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  return (
    <div data-needs-you-more>
      <button
        type="button"
        onClick={() => {
          // Home's detailed panels open and close with this list (needs-stack-fold.tsx, DK5)
          const next = !open;
          setOpen(next);
          announceNeedsYouMore(next);
        }}
        aria-expanded={open}
        aria-controls="needs-you-more-list"
        className="inline-flex items-center gap-1.5 min-h-11 font-body text-sm font-semibold text-steel hover:text-chalk"
      >
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        {open ? FEWER_LABEL : moreLabel(items.length)}
      </button>
      {open && (
        <ul id="needs-you-more-list" className="bg-surface rounded-card divide-y divide-steel/15 px-4">
          {items.map((item) => (
            <li key={item.id} className="py-1.5 flex flex-wrap items-center justify-between gap-x-4" data-needs-you-kind={item.kind}>
              <p className="font-body text-sm text-chalk min-w-0 flex-1 py-1.5">
                {item.profileHref ? (
                  <Link prefetch={false} href={item.profileHref} className="font-medium underline-offset-2 hover:underline">
                    {item.name}
                  </Link>
                ) : (
                  <span className="font-medium">{item.name}</span>
                )}{" "}
                <span className="text-steel">{item.sentence}</span>
              </p>
              <ItemAction item={item} viewer={viewer} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
