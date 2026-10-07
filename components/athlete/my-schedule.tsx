"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import {
  SHEET_COPY,
  addDays,
  dayLabel,
  freezeLengthOptions,
  isOverdue,
  openRequest,
  requestStatusLine,
  requestableKinds,
  scheduleStateLine,
  scheduleSummary,
  todayKey,
  type RequestForUi,
  type RequestKind,
  type SeriesForUi,
} from "@/lib/schedule-request-ui";

export interface ScheduleItem {
  series: SeriesForUi;
  nextSessionLabel: string | null;
  requests: RequestForUi[]; // newest first
}

// "My schedule": the client's weekly schedule, its state, and three plain buttons to ask for a pause, a freeze or to cancel. Each opens a one-tap sheet with the day it
// starts, an optional private note for the coach, and one main button. The request goes to the database (which checks it is the client's own schedule); the coach
// decides nothing: it takes effect on the day chosen unless the coach handles it first. Never worded around money.
export function MySchedule({ groupId, items, canRequest }: { groupId: string; items: ScheduleItem[]; canRequest: boolean }) {
  return (
    <div className="space-y-5">
      {items.map((item) => (
        <ScheduleCard key={item.series.id} groupId={groupId} item={item} canRequest={canRequest} />
      ))}
    </div>
  );
}

function ScheduleCard({ groupId, item, canRequest }: { groupId: string; item: ScheduleItem; canRequest: boolean }) {
  const router = useRouter();
  const [sheet, setSheet] = useState<RequestKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { series, requests } = item;
  const open = openRequest(requests, series.id);
  const kinds = requestableKinds(series.status);
  const history = requests.filter((r) => r !== open && r.status !== "withdrawn").slice(0, 2);

  const sentOn = (r: RequestForUi) => dayLabel(todayKey(series.timezone, new Date(r.createdAt)));

  async function withdraw(r: RequestForUi) {
    setBusy(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: e } = await supabase.rpc("withdraw_schedule_request", { p_request_id: r.id });
    setBusy(false);
    if (e) setError(e.message);
    else router.refresh();
  }

  return (
    <section className="border border-steel/30 bg-surface/40 p-4" aria-label="Your weekly schedule">
      <p className="font-display font-bold text-xl uppercase leading-tight">{scheduleSummary(series)}</p>
      <p className="font-body text-sm text-steel mt-1">{scheduleStateLine(series)}</p>
      {item.nextSessionLabel && series.status === "active" && <p className="font-body text-sm text-chalk mt-3">Next session: {item.nextSessionLabel}</p>}

      {open && (
        <div className="mt-4 border-t border-steel/20 pt-4" role="status">
          <p className="font-body text-sm text-chalk">{requestStatusLine(open, sentOn(open))}</p>
          {isOverdue(open) && (
            <Link href={`/groups/${groupId}/messages`} className="mt-3 flex h-11 items-center justify-center border border-steel/40 font-body text-sm text-chalk">
              Message my coach
            </Link>
          )}
          {canRequest && open.status === "pending" && (
            <button type="button" onClick={() => withdraw(open)} disabled={busy} className="mt-3 h-11 px-4 font-body text-sm text-steel underline underline-offset-2 disabled:opacity-50">
              Withdraw this request
            </button>
          )}
        </div>
      )}

      {!open && canRequest && kinds.length > 0 && (
        <div className="mt-4 grid gap-2">
          {kinds.map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => {
                setError(null);
                setSheet(kind);
              }}
              className="h-11 border border-steel/40 px-4 text-left font-body text-sm text-chalk"
            >
              {SHEET_COPY[kind].title}
            </button>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <ul className="mt-4 space-y-1 border-t border-steel/20 pt-3">
          {history.map((r) => (
            <li key={r.id} className="font-body text-xs text-steel">
              {requestStatusLine(r, sentOn(r))}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-3 font-body text-sm text-chalk" role="alert">{error}</p>}

      {sheet && <RequestSheet kind={sheet} series={series} onClose={() => setSheet(null)} onSent={() => { setSheet(null); router.refresh(); }} />}
    </section>
  );
}

function RequestSheet({ kind, series, onClose, onSent }: { kind: RequestKind; series: SeriesForUi; onClose: () => void; onSent: () => void }) {
  const copy = SHEET_COPY[kind];
  const today = todayKey(series.timezone);
  const [effectiveOn, setEffectiveOn] = useState(today);
  const [resumeOn, setResumeOn] = useState(addDays(today, 14));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: e } = await supabase.rpc("request_schedule_change", {
      p_series_id: series.id,
      p_kind: kind,
      p_effective_on: effectiveOn,
      p_resume_on: kind === "freeze" ? resumeOn : null,
      p_note: note.trim() || null,
    });
    setBusy(false);
    if (e) setError(e.message);
    else onSent();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60" role="dialog" aria-modal="true" aria-label={copy.title}>
      <div className="max-h-[92dvh] w-full overflow-y-auto border-t border-steel/30 bg-graphite p-5 pb-8">
        <div className="flex items-start justify-between gap-4">
          <h2 className="font-display font-bold text-2xl uppercase leading-tight">{copy.title}</h2>
          <button type="button" onClick={onClose} className="h-11 w-11 shrink-0 font-body text-steel" aria-label="Close">
            ✕
          </button>
        </div>
        <p className="font-body text-sm text-steel mt-2">{copy.intro}</p>

        <label className="mt-5 block font-body text-sm text-chalk">
          {copy.dateLabel}
          <input
            type="date"
            value={effectiveOn}
            min={today}
            onChange={(e) => {
              setEffectiveOn(e.target.value);
              if (kind === "freeze" && e.target.value && resumeOn <= e.target.value) setResumeOn(addDays(e.target.value, 14));
            }}
            className="mt-1 block h-11 w-full border border-steel/40 bg-transparent px-3 font-body text-chalk"
          />
        </label>
        <p className="font-body text-xs text-steel mt-1">Your sessions on or before this day stay on your calendar.</p>

        {kind === "freeze" && (
          <div className="mt-5">
            <p className="font-body text-sm text-chalk">How long?</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {freezeLengthOptions(effectiveOn).map((o) => (
                <button
                  key={o.label}
                  type="button"
                  onClick={() => setResumeOn(o.resumeOn)}
                  className={`h-11 border px-4 font-body text-sm ${resumeOn === o.resumeOn ? "border-chalk text-chalk" : "border-steel/40 text-steel"}`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <label className="mt-3 block font-body text-sm text-chalk">
              Start again on
              <input
                type="date"
                value={resumeOn}
                min={addDays(effectiveOn, 1)}
                max={addDays(effectiveOn, 84)}
                onChange={(e) => setResumeOn(e.target.value)}
                className="mt-1 block h-11 w-full border border-steel/40 bg-transparent px-3 font-body text-chalk"
              />
            </label>
          </div>
        )}

        <label className="mt-5 block font-body text-sm text-chalk">
          What&apos;s going on? (optional)
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 500))}
            rows={3}
            className="mt-1 block w-full border border-steel/40 bg-transparent px-3 py-2 font-body text-chalk"
          />
        </label>
        <p className="font-body text-xs text-steel mt-1">Only your coach can read this.</p>

        {error && <p className="mt-3 font-body text-sm text-chalk" role="alert">{error}</p>}
        <button type="button" onClick={send} disabled={busy || !effectiveOn || (kind === "freeze" && !resumeOn)} className="mt-5 h-12 w-full bg-rust font-display text-base font-bold uppercase tracking-wide text-chalk disabled:opacity-50">
          {busy ? "Sending…" : copy.button}
        </button>
      </div>
    </div>
  );
}
