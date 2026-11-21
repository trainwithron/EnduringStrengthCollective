"use client";

import { useEffect, useState } from "react";
import { FOCUSABLE_ROW } from "@/lib/requests-center";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import { checked } from "@/lib/checked-write";
import { confirmDialog } from "@/components/shared/confirm-dialog";
import { InitialsAvatar } from "@/components/shared/initials-avatar";
import { coachThreadHref, sendDirectMessage } from "@/lib/direct-message-send";
import { foldedLine, isLowAnswer, sentLabel, shortDateLabel, weightChange, workoutsValue } from "@/lib/weekly-checkin";
import type { ReviewItem } from "@/lib/weekly-checkin-coach";

// Check-ins (Ron, Nov 20: R2; the approved board). The newest waiting check-in is open as a card; the rest are folded rows that open in its place. "Send and mark reviewed" sends the
// reply as a direct message (the same send and push as Messages, lib/direct-message-send.ts) and marks it reviewed; "Reviewed" just marks it. The footer reminds the clients who
// have not sent this week's (once a day, after a confirm).
export function CheckinReviewList({
  items: initialItems,
  photos,
  coach,
  timeZone,
  nowIso,
  weekStart,
  notSentCount,
  focusId = null,
}: {
  items: ReviewItem[];
  photos: Record<string, { id: string; url: string }[]>;
  coach: { id: string; name: string };
  timeZone: string;
  nowIso: string;
  weekStart: string;
  notSentCount: number;
  // the check-in Needs you named: open first and shown (the list is newest first, so it could be at the bottom)
  focusId?: string | null;
}) {
  const [items, setItems] = useState(initialItems);
  const focusHere = focusId && initialItems.some((i) => i.id === focusId) ? focusId : null;
  const [openId, setOpenId] = useState<string | null>(focusHere ?? initialItems[0]?.id ?? null);
  useEffect(() => {
    if (!focusHere) return;
    const el = document.getElementById(`checkin-${focusHere}`);
    el?.setAttribute("data-focused", "true");
    el?.scrollIntoView({ block: "start", behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [done, setDone] = useState<{ name: string; href: string | null } | null>(null);
  const now = new Date(nowIso);

  function finish(item: ReviewItem, replied: boolean) {
    const rest = items.filter((i) => i.id !== item.id);
    setItems(rest);
    setOpenId(rest[0]?.id ?? null);
    setDone({ name: item.name.split(" ")[0] || item.name, href: replied ? coachThreadHref(item.groupId, item.athleteId) : null });
  }

  return (
    <div className="space-y-4" data-checkin-review>
      <div className="flex items-center gap-3">
        <h1 className="font-display font-bold text-3xl leading-none">Check-ins</h1>
        {items.length > 0 && <span className="rounded-token-pill tint-alert px-3 py-1 font-body text-xs font-semibold text-alert">{items.length} to review</span>}
      </div>

      {done && (
        <p className="tint-win rounded-card px-4 py-3 font-body text-sm text-chalk" role="status">
          {done.href ? `Sent to ${done.name} and marked reviewed.` : `${done.name}'s check-in is marked reviewed.`}
          {done.href && (
            <>
              {" "}
              <Link href={done.href} className="text-rust-ink font-medium underline underline-offset-2">
                Open the conversation
              </Link>
            </>
          )}
        </p>
      )}

      {items.length === 0 ? (
        <p className="bg-surface rounded-card px-4 py-5 font-body text-sm text-steel">You&apos;re caught up. No check-ins to review.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) =>
            item.id === openId ? (
              <li key={item.id} id={`checkin-${item.id}`} className={FOCUSABLE_ROW}>
                <OpenCheckin item={item} photos={photos[item.id] ?? []} coach={coach} timeZone={timeZone} now={now} weekStart={weekStart} onDone={(replied) => finish(item, replied)} />
              </li>
            ) : (
              <li key={item.id} id={`checkin-${item.id}`} className={FOCUSABLE_ROW}>
                <button
                  type="button"
                  onClick={() => setOpenId(item.id)}
                  aria-expanded={false}
                  className="w-full flex items-center gap-3 bg-surface rounded-card px-4 py-3 text-left active:bg-surface-2"
                >
                  <InitialsAvatar name={item.name} tintKey={item.athleteId} className="w-9 h-9 text-xs" />
                  <span className="flex-1 min-w-0">
                    <span className="block font-body text-[15px] font-semibold text-chalk truncate">{item.name}</span>
                    <span className="block font-body text-xs text-steel truncate">{foldedLine(item, timeZone, now)}</span>
                  </span>
                  <ChevronDown className="w-4 h-4 text-steel shrink-0" aria-hidden="true" />
                </button>
              </li>
            )
          )}
        </ul>
      )}

      <RemindFooter count={notSentCount} />
    </div>
  );
}

function Chip({ children, low = false }: { children: React.ReactNode; low?: boolean }) {
  return <span className={`rounded-token-pill px-2.5 py-1 font-body text-xs text-chalk ${low ? "tint-alert" : "bg-surface-2"}`}>{children}</span>;
}

function OpenCheckin({
  item,
  photos,
  coach,
  timeZone,
  now,
  weekStart,
  onDone,
}: {
  item: ReviewItem;
  photos: { id: string; url: string }[];
  coach: { id: string; name: string };
  timeZone: string;
  now: Date;
  weekStart: string;
  onDone: (replied: boolean) => void;
}) {
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const change = weightChange(item.snapshot);

  async function markReviewed(replyMessageId: string | null): Promise<boolean> {
    const r = await checked(
      createBrowserClient()
        .from("weekly_checkins")
        .update({ reviewed_at: new Date().toISOString(), ...(replyMessageId ? { reply_message_id: replyMessageId } : {}) })
        .eq("id", item.id)
        .select("id"),
      { expectRows: true, message: "Couldn't mark it reviewed. Try again." }
    );
    if (!r.ok) setError(r.error);
    return r.ok;
  }

  async function sendAndReview() {
    if (!reply.trim() || busy) return;
    setBusy(true);
    setError(null);
    const sent = await sendDirectMessage(createBrowserClient(), { groupId: item.groupId, senderId: coach.id, senderName: coach.name, recipientId: item.athleteId, body: reply });
    if (!sent) {
      setBusy(false);
      setError("That didn't send. Try again.");
      return;
    }
    // The reply is sent whatever happens next; only the mark is retried.
    const ok = await markReviewed(sent.id);
    setBusy(false);
    if (ok) onDone(true);
    else setReply("");
  }

  async function justReview() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const ok = await markReviewed(null);
    setBusy(false);
    if (ok) onDone(false);
  }

  return (
    <article className="bg-surface rounded-card p-4" aria-label={`${item.name}'s check-in`}>
      <div className="flex items-center gap-3">
        <InitialsAvatar name={item.name} tintKey={item.athleteId} className="w-10 h-10 text-xs" />
        <div className="min-w-0">
          <p className="font-body text-[15px] font-semibold text-chalk truncate">{item.name}</p>
          <p className="font-body text-xs text-steel">
            {sentLabel(item.submittedAt, timeZone, now)}
            {item.weekStart !== weekStart && ` · week of ${shortDateLabel(item.weekStart)}`}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 mt-3">
        <Chip>Workouts {workoutsValue(item.snapshot)}</Chip>
        <Chip low={isLowAnswer(item.energy)}>Energy {item.energy}</Chip>
        <Chip low={isLowAnswer(item.eating)}>Eating {item.eating}</Chip>
        {change && <Chip>Weight {change}</Chip>}
      </div>

      {item.win && (
        <p className="font-body text-sm text-chalk mt-3 whitespace-pre-wrap break-words">
          <span className="text-win font-semibold">Win:</span> {item.win}
        </p>
      )}
      {item.hard && (
        <p className="font-body text-sm text-chalk mt-1.5 whitespace-pre-wrap break-words">
          <span className="text-alert font-semibold">Hard:</span> {item.hard}
        </p>
      )}

      {photos.length > 0 && (
        <ul className="flex gap-2 mt-3 overflow-x-auto" aria-label="Progress photos">
          {photos.map((p) => (
            <li key={p.id} className="shrink-0">
              <a href={p.url} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link to the client's own photo */}
                <img src={p.url} alt="Progress photo" className="w-20 h-20 object-cover rounded-row" />
              </a>
            </li>
          ))}
        </ul>
      )}

      <textarea
        aria-label="Your reply"
        placeholder="Your reply"
        value={reply}
        onChange={(e) => setReply(e.target.value)}
        rows={3}
        className="w-full mt-3 bg-surface-2 border border-steel/30 text-chalk px-3 py-2 font-body text-sm focus:outline-none focus:border-rust"
      />
      {error && (
        <p className="font-body text-xs text-rust-ink mt-1" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 mt-2">
        <button
          type="button"
          onClick={() => void sendAndReview()}
          disabled={busy || !reply.trim()}
          className="min-h-11 px-5 rounded-token-pill bg-rust text-graphite font-body text-sm font-semibold disabled:opacity-40"
        >
          {busy ? "Saving…" : "Send and mark reviewed"}
        </button>
        <button type="button" onClick={() => void justReview()} disabled={busy} className="min-h-11 px-4 rounded-token-pill border border-steel/40 text-chalk font-body text-sm disabled:opacity-40">
          Reviewed
        </button>
      </div>
    </article>
  );
}

function RemindFooter({ count }: { count: number }) {
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [line, setLine] = useState<string | null>(null);

  if (count === 0) return <p className="font-body text-sm text-steel pt-2">Everyone has sent this week&apos;s check-in.</p>;

  async function remind() {
    const ok = await confirmDialog({
      message: `Send a reminder to ${count} ${count === 1 ? "client who hasn't" : "clients who haven't"} sent this week's check-in? Each gets one notification (none during their quiet hours).`,
      confirmLabel: "Remind them",
    });
    if (!ok) return;
    setState("sending");
    try {
      const res = await fetch("/api/checkins/remind", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { error?: string; reminded?: number };
      if (!res.ok) {
        setLine(data.error ?? "Couldn't send the reminders. Try again.");
        setState("idle");
        return;
      }
      const n = data.reminded ?? 0;
      setLine(`Reminder sent to ${n} ${n === 1 ? "client" : "clients"}.${n < count ? " The others have notifications off or are in their quiet hours." : ""}`);
      setState("done");
    } catch {
      setLine("Couldn't send the reminders. Check your connection and try again.");
      setState("idle");
    }
  }

  return (
    <div className="pt-2">
      <p className="font-body text-sm text-steel">
        Not sent yet this week: {count} {count === 1 ? "client" : "clients"}
        {state !== "done" && (
          <>
            {" · "}
            <button type="button" onClick={() => void remind()} disabled={state === "sending"} className="min-h-11 text-rust-ink font-medium disabled:opacity-50">
              {state === "sending" ? "Reminding…" : "Remind them"}
            </button>
          </>
        )}
      </p>
      {line && (
        <p className="font-body text-xs text-steel mt-1" role="status">
          {line}
        </p>
      )}
    </div>
  );
}
