"use client";

import { useMemo, useRef, useState } from "react";
import { FIRST_NAME_TOKEN, MAX_BROADCAST_LENGTH, mergeFirstName } from "@/lib/broadcast-merge";

export interface BroadcastGroup {
  id: string;
  name: string;
  orgName: string | null; // only set when the coach spans more than one org
}

export interface BroadcastAthlete {
  athleteId: string;
  groupId: string;
  fullName: string;
  // Under-13 without verified parental consent — never in the default
  // recipient list, but a coach can add them by hand.
  excludedByDefault: boolean;
}

// Compose once, merge each client's first name, confirm, send. Delivery
// is in-app DM + push only. The recipient list the server finally acts
// on is re-validated there — this component's selection is a request,
// not an authorization.
export function BroadcastComposer({
  groups,
  athletes,
}: {
  groups: BroadcastGroup[];
  athletes: BroadcastAthlete[];
}) {
  const [template, setTemplate] = useState("Hey {first_name}, ");
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set(groups.map((g) => g.id)));
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [addedExcluded, setAddedExcluded] = useState<Set<string>>(new Set());
  const [sampleIndex, setSampleIndex] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ sent: number; pushed: number } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendingRef = useRef(false);

  const groupOrder = groups.map((g) => g.id);

  // One row per person: if a client is in two selected groups, they get
  // exactly one message, in the first selected group.
  const candidates = useMemo(() => {
    const seen = new Set<string>();
    const out: BroadcastAthlete[] = [];
    for (const gid of groupOrder) {
      if (!selectedGroups.has(gid)) continue;
      for (const a of athletes) {
        if (a.groupId !== gid || seen.has(a.athleteId)) continue;
        seen.add(a.athleteId);
        out.push(a);
      }
    }
    return out.sort((a, b) => a.fullName.localeCompare(b.fullName));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [athletes, selectedGroups]);

  const recipients = candidates.filter((a) =>
    a.excludedByDefault ? addedExcluded.has(a.athleteId) : !deselected.has(a.athleteId)
  );
  const sample = recipients[sampleIndex % Math.max(recipients.length, 1)];
  const groupNameById = new Map(groups.map((g) => [g.id, g]));

  function toggleGroup(id: string) {
    setSelectedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setSampleIndex(0);
  }

  function toggleRecipient(a: BroadcastAthlete) {
    if (a.excludedByDefault) {
      setAddedExcluded((prev) => {
        const next = new Set(prev);
        if (next.has(a.athleteId)) next.delete(a.athleteId);
        else next.add(a.athleteId);
        return next;
      });
    } else {
      setDeselected((prev) => {
        const next = new Set(prev);
        if (next.has(a.athleteId)) next.delete(a.athleteId);
        else next.add(a.athleteId);
        return next;
      });
    }
  }

  function insertToken() {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? template.length;
    const end = el?.selectionEnd ?? template.length;
    setTemplate(template.slice(0, start) + FIRST_NAME_TOKEN + template.slice(end));
  }

  function openConfirm() {
    setError(null);
    setIdempotencyKey(crypto.randomUUID());
    setConfirming(true);
  }

  async function send() {
    // A ref, not just state: two clicks in the same tick both see the
    // stale `sending=false`. The server's idempotency key is the real
    // guard; this keeps the browser from even firing the second request.
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/broadcast/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idempotencyKey,
          template,
          recipients: recipients.map((r) => ({ athleteId: r.athleteId, groupId: r.groupId })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't send — nothing was sent.");
        setIdempotencyKey(crypto.randomUUID());
        sendingRef.current = false;
        setSending(false);
        return;
      }
      setResult({ sent: data.sent ?? 0, pushed: data.pushed ?? 0 });
      setConfirming(false);
      setSending(false);
    } catch {
      setError("Couldn't send — nothing was sent.");
      setIdempotencyKey(crypto.randomUUID());
      sendingRef.current = false;
      setSending(false);
    }
  }

  if (result) {
    return (
      <div className="border border-positive/40 bg-surface/60 p-6 max-w-xl">
        <h2 className="font-display uppercase text-sm tracking-wide mb-2">Announcement sent</h2>
        <p className="font-body text-sm text-steel">
          Delivered in-app to {result.sent} client{result.sent === 1 ? "" : "s"}
          {result.pushed > 0 ? `, with a push notification to ${result.pushed} device${result.pushed === 1 ? "" : "s"}` : ""}
          . Anyone without push sees it as an unread message.
        </p>
      </div>
    );
  }

  const tooLong = template.length > MAX_BROADCAST_LENGTH;
  const canReview = template.trim().length > 0 && recipients.length > 0 && !tooLong;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="font-body text-xs text-steel uppercase tracking-wide">Message</label>
          <button
            type="button"
            onClick={insertToken}
            className="font-body text-xs text-rust underline underline-offset-2"
          >
            Insert first name
          </button>
        </div>
        <textarea
          ref={textareaRef}
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          rows={5}
          className="w-full bg-surface border border-steel/30 text-chalk px-3 py-2 font-body text-sm focus:outline-none focus:border-rust"
          placeholder="Hey {first_name}, I'm out of town for six days. Sessions start back up next week."
        />
        <p className={`font-body text-[11px] mt-1 ${tooLong ? "text-rust" : "text-steel"}`}>
          {template.length}/{MAX_BROADCAST_LENGTH} — {FIRST_NAME_TOKEN} becomes each client&apos;s first name.
        </p>
      </div>

      <div className="border border-steel/20 bg-surface/40 p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="font-body text-xs text-steel uppercase tracking-wide">
            Preview{sample ? ` — as ${sample.fullName} sees it` : ""}
          </p>
          {recipients.length > 1 && (
            <button
              type="button"
              onClick={() => setSampleIndex((i) => i + 1)}
              className="font-body text-xs text-rust underline underline-offset-2"
            >
              Next sample
            </button>
          )}
        </div>
        <p className="font-body text-sm text-chalk whitespace-pre-wrap">
          {sample ? mergeFirstName(template, sample.fullName) : "Pick at least one recipient to preview."}
        </p>
      </div>

      {groups.length > 1 && (
        <div>
          <p className="font-body text-xs text-steel uppercase tracking-wide mb-2">Groups</p>
          <div className="flex flex-wrap gap-2">
            {groups.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => toggleGroup(g.id)}
                className={`h-8 px-3 border font-body text-xs ${
                  selectedGroups.has(g.id) ? "border-rust text-chalk bg-rust/10" : "border-steel/30 text-steel"
                }`}
              >
                {g.orgName ? `${g.orgName} · ` : ""}
                {g.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="font-body text-xs text-steel uppercase tracking-wide mb-2">
          Recipients ({recipients.length})
        </p>
        <div className="border border-steel/20 max-h-72 overflow-y-auto divide-y divide-steel/15">
          {candidates.length === 0 && (
            <p className="font-body text-sm text-steel px-3 py-4">No training clients in the selected groups.</p>
          )}
          {candidates.map((a) => {
            const checked = a.excludedByDefault ? addedExcluded.has(a.athleteId) : !deselected.has(a.athleteId);
            return (
              <label key={a.athleteId} className="flex items-center gap-3 px-3 py-2 font-body text-sm cursor-pointer">
                <input type="checkbox" checked={checked} onChange={() => toggleRecipient(a)} className="accent-rust" />
                <span className="flex-1">{a.fullName}</span>
                {groups.length > 1 && (
                  <span className="text-[11px] text-steel">{groupNameById.get(a.groupId)?.name}</span>
                )}
                {a.excludedByDefault && (
                  <span className="text-[11px] text-rust">Under 13, no verified parental consent</span>
                )}
              </label>
            );
          })}
        </div>
      </div>

      {error && (
        <p className="font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={openConfirm}
        disabled={!canReview}
        className="h-10 px-6 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
      >
        Review &amp; send
      </button>

      {confirming && (
        <div className="fixed inset-0 z-50 bg-graphite/80 flex items-center justify-center px-4" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <div className="bg-graphite border border-steel/30 p-6 max-w-md w-full">
            <h2 id="confirm-title" className="font-display uppercase text-sm tracking-wide mb-1">
              Send to {recipients.length} client{recipients.length === 1 ? "" : "s"}?
            </h2>
            <p className="font-body text-xs text-steel mb-4">
              Delivered as an in-app message plus a push notification, under your name. This can&apos;t be unsent.
            </p>
            <div className="space-y-2 mb-4">
              {recipients.slice(0, 3).map((r) => (
                <div key={r.athleteId} className="border border-steel/20 p-2">
                  <p className="font-body text-[11px] text-steel">{r.fullName}</p>
                  <p className="font-body text-xs text-chalk whitespace-pre-wrap">{mergeFirstName(template, r.fullName)}</p>
                </div>
              ))}
              {recipients.length > 3 && (
                <p className="font-body text-[11px] text-steel">…and {recipients.length - 3} more, each with their own name.</p>
              )}
            </div>
            {error && (
              <p className="font-body text-xs text-rust mb-3" role="alert">
                {error}
              </p>
            )}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={send}
                disabled={sending}
                className="h-9 px-5 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
              >
                {sending ? "Sending…" : `Send to ${recipients.length}`}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={sending}
                className="font-body text-xs text-steel disabled:opacity-40"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
