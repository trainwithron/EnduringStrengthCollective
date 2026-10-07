"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";
import { buildCheckInDraft, buildOfferPauseOrFreezeDraft, buildScheduleReplyDraft } from "@/lib/schedule-request-drafts";
import { dayLabel, isOverdue, scheduleSummary, todayKey, type RequestKind } from "@/lib/schedule-request-ui";

export interface ScheduleRequestCardData {
  id: string;
  kind: RequestKind;
  clientName: string;
  athleteId: string;
  groupId: string;
  effectiveOn: string;
  resumeOn: string | null;
  createdAt: string;
  note: string | null;
  weekday: number;
  startTime: string;
  durationMinutes: number;
  timezone: string | null;
  status: "pending" | "applying";
}

const PHRASE: Record<RequestKind, string> = { pause: "pause", freeze: "freeze", cancel: "end" };

// One client's request, for the coach: what they asked for, the day it takes effect, their private note, and what the coach can do. There is no decline: the request takes
// effect on the day chosen unless the coach handles it first. Done applies it now (allowed on or after that day); Handled only marks it dealt with.
export function ScheduleRequestCard({
  data,
  busy,
  confirming,
  onAskDone,
  onCancelDone,
  onDone,
  onHandled,
  now = new Date(),
}: {
  data: ScheduleRequestCardData;
  busy: boolean;
  confirming: boolean;
  onAskDone: () => void;
  onCancelDone: () => void;
  onDone: () => void;
  onHandled: () => void;
  now?: Date;
}) {
  const first = data.clientName.trim().split(/\s+/)[0] ?? "";
  const summary = scheduleSummary({ weekday: data.weekday, startTime: data.startTime, durationMinutes: data.durationMinutes });
  const dueToday = data.effectiveOn <= todayKey(data.timezone, now);
  const waiting = isOverdue({ status: data.status === "pending" ? "pending" : "applying", createdAt: data.createdAt }, now);
  const days = Math.max(2, Math.floor((now.getTime() - new Date(data.createdAt).getTime()) / 86400000));
  const effectiveLabel = dayLabel(data.effectiveOn);
  const messageBase = `/groups/${data.groupId}/messages/${data.athleteId}?draft=`;
  const reply = buildScheduleReplyDraft({ firstName: first, kind: data.kind, effectiveLabel, resumeLabel: data.resumeOn ? dayLabel(data.resumeOn) : null });
  const offer = buildOfferPauseOrFreezeDraft(first);
  const checkIn = buildCheckInDraft(first);

  return (
    <li className="border border-rust/30 p-3" data-testid="schedule-request-card">
      <p className="font-body text-sm text-chalk">
        <span className="font-bold">{data.clientName}</span> asked to {PHRASE[data.kind]} their weekly schedule ({summary})
        {data.kind === "freeze" && data.resumeOn ? ` until ${dayLabel(data.resumeOn)}` : ""}.
      </p>
      <p className="font-body text-xs text-steel mt-1">
        {data.kind === "cancel" ? "Last session day" : "Sessions stay through"} {effectiveLabel}
        {waiting ? ` · waiting ${days} days` : ""}
        {data.status === "applying" ? " · being applied now" : ""}
      </p>
      {data.note && <p className="font-body text-sm text-chalk mt-2 border-l-2 border-steel/40 pl-3">&ldquo;{data.note}&rdquo;</p>}

      {confirming ? (
        <div className="mt-3" role="alert">
          <p className="font-body text-sm text-chalk">
            Apply now? {first || "Their"} sessions after {effectiveLabel} come off the calendar{data.kind === "cancel" ? " and the schedule ends" : ""}. {first ? `${first} is` : "They are"} told.
          </p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={onDone} disabled={busy} className="h-11 bg-rust px-4 font-body text-sm font-bold text-chalk disabled:opacity-50">
              Apply now
            </button>
            <button type="button" onClick={onCancelDone} disabled={busy} className="h-11 border border-steel/40 px-4 font-body text-sm text-chalk">
              Not yet
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Link href={`${messageBase}${encodeURIComponent(data.kind === "cancel" ? checkIn : reply)}`} className="inline-flex h-11 items-center border border-steel/40 px-4 font-body text-sm text-chalk">
            Message
          </Link>
          {data.kind === "cancel" && (
            <Link href={`${messageBase}${encodeURIComponent(offer)}`} className="inline-flex h-11 items-center border border-steel/40 px-4 font-body text-sm text-chalk">
              Offer pause or freeze
            </Link>
          )}
          {dueToday ? (
            <button type="button" onClick={onAskDone} disabled={busy} className="h-11 border border-chalk px-4 font-body text-sm font-bold text-chalk disabled:opacity-50">
              Done
            </button>
          ) : (
            <span className="font-body text-xs text-steel">Applies on its own after {effectiveLabel}.</span>
          )}
          <button type="button" onClick={onHandled} disabled={busy} className="h-11 px-2 font-body text-xs text-steel underline underline-offset-2 disabled:opacity-50">
            Mark handled
          </button>
        </div>
      )}
    </li>
  );
}

// Client requests to pause, freeze or cancel their weekly schedule (migration 0297), shown with the other things that need the coach's decision. Shows nothing when there is
// none, and before the database update is applied the lookup fails quietly and the panel stays empty.
export function ScheduleRequestsPanel() {
  const [items, setItems] = useState<ScheduleRequestCardData[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function load() {
    const supabase = createBrowserClient();
    const { data, error } = await supabase
      .from("schedule_requests")
      .select(
        "id, kind, effective_on, resume_on, status, created_at, athlete_id, group_id, profiles!schedule_requests_athlete_id_fkey ( full_name ), recurring_booking_series ( weekday, start_time, duration_minutes, timezone )"
      )
      .in("status", ["pending", "applying"])
      .order("created_at", { ascending: true })
      .limit(30);
    if (error || !data) return;
    const rows = data as any[];
    const noteById = new Map<string, string>();
    if (rows.length > 0) {
      const { data: noteRows } = await supabase.from("schedule_request_notes").select("request_id, note").in("request_id", rows.map((r) => r.id));
      for (const n of (noteRows ?? []) as { request_id: string; note: string }[]) noteById.set(n.request_id, n.note);
    }
    setItems(
      rows
        .filter((r) => r.recurring_booking_series)
        .map((r) => ({
          id: r.id as string,
          kind: r.kind as RequestKind,
          clientName: (r.profiles?.full_name as string | undefined) ?? "A client",
          athleteId: r.athlete_id as string,
          groupId: r.group_id as string,
          effectiveOn: r.effective_on as string,
          resumeOn: (r.resume_on as string | null) ?? null,
          createdAt: r.created_at as string,
          note: noteById.get(r.id as string) ?? null,
          weekday: r.recurring_booking_series.weekday as number,
          startTime: String(r.recurring_booking_series.start_time ?? "").slice(0, 5),
          durationMinutes: r.recurring_booking_series.duration_minutes as number,
          timezone: (r.recurring_booking_series.timezone as string | null) ?? null,
          status: r.status as "pending" | "applying",
        }))
    );
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function act(id: string, action: "done" | "handled") {
    setBusyId(id);
    setMessage(null);
    try {
      const res = await fetch("/api/series/schedule-request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: id, action }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) {
        setMessage({ text: body.error ?? body.message ?? "That didn't save. Nothing was changed.", error: true });
      } else {
        setMessage({ text: action === "done" ? "Done. The schedule was changed and the client was told." : "Marked as handled.", error: false });
        setItems((prev) => prev.filter((i) => i.id !== id));
      }
    } catch {
      setMessage({ text: "That didn't save. Check your connection and try again.", error: true });
    }
    setBusyId(null);
    setConfirmId(null);
  }

  if (items.length === 0 && !message) return null;

  return (
    <section className="border border-rust/40 bg-rust/5 rounded-token-lg p-4 mb-6" aria-label="Schedule requests">
      <h2 className="font-body text-xs text-rust uppercase tracking-wide font-bold">Schedule requests</h2>
      <ul className="mt-3 space-y-3">
        {items.map((data) => (
          <ScheduleRequestCard
            key={data.id}
            data={data}
            busy={busyId === data.id}
            confirming={confirmId === data.id}
            onAskDone={() => setConfirmId(data.id)}
            onCancelDone={() => setConfirmId(null)}
            onDone={() => act(data.id, "done")}
            onHandled={() => act(data.id, "handled")}
          />
        ))}
      </ul>
      {message && (
        <p className={`mt-3 font-body text-sm ${message.error ? "text-rust" : "text-chalk"}`} role={message.error ? "alert" : "status"}>
          {message.text}
        </p>
      )}
    </section>
  );
}

