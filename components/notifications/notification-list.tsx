"use client";

import { useState } from "react";
import { noticeLinkPrefetch } from "@/lib/notice-links";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";
import { groupNotificationsByDay, timeAgo } from "@/lib/notification-days";
import { NOTICE_FILTERS, type NoticeFilter } from "@/lib/notice-filters";

export interface CenterEntry {
  id: string;
  type?: string;
  // which chip it is under (lib/notice-filters.ts)
  filter?: NoticeFilter;
  // a request still waiting that can be answered on the row
  answer?: { kind: "booking" | "client"; requestId: string } | null;
  body: string;
  linkPath: string;
  createdAt: string;
  readAt: string | null;
  groupName: string | null;
}

// The full notification center: everything the viewer has been told, newest first under day headings, with unread marked. All or Unread, and a chip per kind (Requests, Messages, Clients,
// Programs, Business, Other; only the kinds the list has). A session request or a request to train still waiting has its answer on the row. The bell in the header shows the latest few; this is
// the whole list.
export function NotificationList({ initial, timezone }: { initial: CenterEntry[]; timezone: string }) {
  const [items, setItems] = useState(initial);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [kind, setKind] = useState<NoticeFilter | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const unread = items.filter((n) => !n.readAt);
  const kindsPresent = NOTICE_FILTERS.filter((f) => items.some((n) => (n.filter ?? "other") === f.id));
  const visible = (filter === "unread" ? unread : items).filter((n) => !kind || (n.filter ?? "other") === kind);
  const groups = groupNotificationsByDay(visible, timezone);

  async function markRead(ids: string[]) {
    if (ids.length === 0) return;
    const stamp = new Date().toISOString();
    const before = items;
    setItems((prev) => prev.map((n) => (ids.includes(n.id) ? { ...n, readAt: stamp } : n)));
    const supabase = createBrowserClient();
    const { error: updateError } = await supabase.from("notifications").update({ read_at: stamp }).in("id", ids);
    if (updateError) {
      setItems(before);
      setError("That didn't save. Check your connection and try again.");
    } else {
      setError(null);
    }
  }

  // The same answers as the Requests page: a session through the answer route (the client is told at once), a request to train through the client-requests route.
  async function answer(n: CenterEntry, yes: boolean) {
    if (!n.answer || busy) return;
    setBusy(n.id);
    try {
      const res =
        n.answer.kind === "booking"
          ? await fetch("/api/bookings/request-answer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: n.answer.requestId, confirm: yes }) })
          : await fetch("/api/client-requests/answer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: n.answer.requestId, action: yes ? "approve" : "decline" }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        setAnswers((a) => ({ ...a, [n.id]: { ok: false, text: data.error || "That didn't save. Try again." } }));
      } else {
        const text = n.answer.kind === "booking" ? data.line || (yes ? "Confirmed." : "Declined.") : yes ? "Approved. They are your client now." : "Declined. They were told only that you are not taking new clients right now.";
        setAnswers((a) => ({ ...a, [n.id]: { ok: true, text } }));
        if (!n.readAt) void markRead([n.id]);
      }
    } catch {
      setAnswers((a) => ({ ...a, [n.id]: { ok: false, text: "That didn't save. Check your connection and try again." } }));
    } finally {
      setBusy(null);
    }
  }

  const chip = (on: boolean) => `shrink-0 min-h-11 font-body text-sm px-4 border ${on ? "border-chalk text-chalk" : "border-steel/30 text-steel"}`;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex gap-2" role="group" aria-label="Show">
          {(["all", "unread"] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f} className={chip(filter === f)}>
              {f === "all" ? "All" : `Unread${unread.length > 0 ? ` (${unread.length})` : ""}`}
            </button>
          ))}
        </div>
        {unread.length > 0 && (
          <button type="button" onClick={() => markRead(unread.map((n) => n.id))} className="min-h-11 px-2 font-body text-sm text-steel underline">
            Mark all read
          </button>
        )}
      </div>

      {kindsPresent.length > 1 && (
        // one line that scrolls sideways on a phone, never wider than the screen
        <div className="flex gap-2 overflow-x-auto pb-1 mb-4 -mx-1 px-1" role="group" aria-label="Kind" data-notice-kinds>
          <button type="button" onClick={() => setKind(null)} aria-pressed={kind === null} className={chip(kind === null)}>
            Every kind
          </button>
          {kindsPresent.map((f) => (
            <button key={f.id} type="button" onClick={() => setKind(kind === f.id ? null : f.id)} aria-pressed={kind === f.id} className={chip(kind === f.id)}>
              {f.label}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p role="alert" className="font-body text-sm text-rust-ink mb-3">
          {error}
        </p>
      )}

      {groups.length === 0 ? (
        <p className="font-body text-sm text-steel">
          {filter === "unread" ? "You're all caught up." : kind ? "Nothing of this kind." : "Nothing yet. Replies, assignments and reminders will show up here."}
        </p>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.key} aria-label={g.label}>
              <h2 className="font-display uppercase text-xs tracking-wide text-steel mb-2">{g.label}</h2>
              <ul className="divide-y divide-steel/15 border border-steel/20">
                {g.items.map((n) => (
                  <li key={n.id} className={!n.readAt ? "bg-surface" : ""}>
                    <Link href={n.linkPath} prefetch={noticeLinkPrefetch(n.linkPath)} onClick={() => markRead([n.id])} className="flex items-start gap-3 px-4 py-3">
                      <span aria-hidden="true" className={`mt-2 w-1.5 h-1.5 rounded-full shrink-0 ${!n.readAt ? "bg-chalk" : "bg-transparent"}`} />
                      <span className="min-w-0">
                        <span className={`block font-body text-sm break-words ${!n.readAt ? "text-chalk" : "text-steel"}`}>{n.body}</span>
                        <span className="block font-body text-xs text-steel mt-0.5">
                          {n.groupName ? `${n.groupName} · ` : ""}
                          {timeAgo(n.createdAt)}
                          {!n.readAt && <span className="sr-only"> (unread)</span>}
                        </span>
                      </span>
                    </Link>
                    {n.answer && !answers[n.id]?.ok && (
                      <div className="flex gap-2 px-4 pb-3 pl-[2.125rem]" data-notice-answer>
                        <button type="button" onClick={() => answer(n, true)} disabled={busy !== null} className="min-h-11 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
                          {n.answer.kind === "booking" ? "Confirm" : "Approve"}
                        </button>
                        <button type="button" onClick={() => answer(n, false)} disabled={busy !== null} className="min-h-11 px-4 border border-steel/40 text-chalk font-body text-sm disabled:opacity-40">
                          Decline
                        </button>
                      </div>
                    )}
                    {answers[n.id] && (
                      <p className={`px-4 pb-3 pl-[2.125rem] font-body text-xs ${answers[n.id].ok ? "text-positive" : "text-rust-ink"}`} role={answers[n.id].ok ? "status" : "alert"}>
                        {answers[n.id].text}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
