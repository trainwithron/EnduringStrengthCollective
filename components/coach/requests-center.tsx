"use client";

import { useEffect, useState } from "react";
import { LateChangesPanel } from "@/components/coach/late-changes-panel";
import { ScheduleRequestsPanel } from "@/components/coach/schedule-requests-panel";
import { ClientRequestsPanel, type RequestRow } from "@/components/coach/client-requests-panel";
import { GiveBackLateCancelButton } from "@/components/coach/give-back-late-cancel-button";
import { ANSWERED_DAYS, dateLabel, FOCUSABLE_ROW, requestAnchor, type AnsweredRequest, type RequestKind } from "@/lib/requests-center";

const KIND_LABEL: Record<RequestKind, string> = { booking: "Session", late: "Late change", schedule: "Schedule", client: "New client" };

// Everything waiting on the coach's answer, then what was answered in the last 30 days. The waiting sessions, late changes and schedule changes are Home's own panels (decided exactly as there);
// the people asking to train with the coach are the client-requests list. A notice opens the page at its request: the row is marked and scrolled to, waiting or answered; one that is neither
// (answered long ago) says so instead of opening on nothing.
export function RequestsCenter({
  groupIds,
  clients,
  answered,
  waitingCount,
  focus,
  timezone,
  supportEmail,
}: {
  groupIds: string[];
  clients: RequestRow[];
  answered: AnsweredRequest[];
  waitingCount: number;
  focus: { kind: RequestKind; id: string } | null;
  timezone: string;
  supportEmail: string | null;
}) {
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!focus) return;
    const id = requestAnchor(focus.kind, focus.id);
    // The panels read their own rows after the page opens: look for the row for a few seconds.
    let tries = 0;
    const timer = window.setInterval(() => {
      const el = document.getElementById(id);
      if (el) {
        window.clearInterval(timer);
        el.setAttribute("data-focused", "true");
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      } else if (++tries > 24) {
        window.clearInterval(timer);
        setMissing(true);
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [focus]);

  return (
    <div className="space-y-6 max-w-3xl" data-requests-center>
      {missing && (
        <p className="font-body text-sm text-chalk border border-steel/30 p-3" role="status">
          That request isn&apos;t waiting any more. It was answered or closed, and it isn&apos;t in the last {ANSWERED_DAYS} days below.
        </p>
      )}
      {waitingCount === 0 && clients.length === 0 && <p className="font-body text-sm text-steel">Nothing is waiting on your answer right now.</p>}

      <LateChangesPanel groupIds={groupIds} />
      <ScheduleRequestsPanel groupIds={groupIds} />
      {clients.length > 0 && <ClientRequestsPanel requests={clients} supportEmail={supportEmail} title="Asked to train with you" />}

      <section aria-label={`Answered in the last ${ANSWERED_DAYS} days`}>
        <h2 className="font-display uppercase text-lg tracking-wide">Answered in the last {ANSWERED_DAYS} days</h2>
        {answered.length === 0 ? (
          <p className="font-body text-sm text-steel mt-2">Nothing answered yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-steel/15 border border-steel/20">
            {answered.map((a) => (
              <li key={`${a.kind}-${a.id}`} id={requestAnchor(a.kind, a.id)} className={`${FOCUSABLE_ROW} px-4 py-3`} data-answered-request>
                <p className="font-body text-xs text-steel uppercase tracking-wide">
                  {KIND_LABEL[a.kind]}
                  {a.orgName ? ` · ${a.orgName}` : ""}
                </p>
                <p className="font-body text-sm text-chalk mt-0.5 break-words">
                  <b>{a.who}</b> · {a.what}
                </p>
                <p className="font-body text-xs text-steel mt-0.5">
                  {a.outcome}
                  {a.decidedAt ? ` · ${dateLabel(a.decidedAt, timezone)}` : ""}
                </p>
                {a.kind === "late" && a.giveBack && <GiveBackLateCancelButton bookingId={a.id} who={a.who} />}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
