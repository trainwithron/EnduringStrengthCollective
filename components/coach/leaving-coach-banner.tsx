import { ExportBusinessButton } from "@/components/coach/desktop/export-business-button";
import { StartOwnAccountButton } from "@/components/coach/start-own-account-button";
import type { MyDeparture } from "@/lib/leaving-coach";
import { daysLeftToChoose, exportLinkStillWorks, EXPORT_LINK_DAYS, windowEndsAt } from "@/lib/leaving-coach-policy";

// Shown at the top of a leaving coach's Home, one section for each organization they are leaving.
//   inside their seven days: nothing has moved, they keep coaching, and choose between starting their own account and taking a copy of everything;
//   after (their days ran out, or they were let go): coaching access has ended, and the one export they are owed is a click away for a while.
export function LeavingCoachBanner({ departures, supportEmail }: { departures: (MyDeparture & { exportGroupId: string | null })[]; supportEmail: string | null }) {
  if (departures.length === 0) return null;
  return (
    <>
      {departures.map((d) => (
        <DepartureSection key={d.organizationId} departure={d} supportEmail={supportEmail} />
      ))}
    </>
  );
}

function DepartureSection({ departure: d, supportEmail }: { departure: MyDeparture & { exportGroupId: string | null }; supportEmail: string | null }) {
  const now = new Date();
  if (d.endedAt) {
    const works = exportLinkStillWorks(d.endedAt, now);
    return (
      <section className="mb-6 border border-rust/50 p-4" aria-labelledby={`leaving-${d.organizationId}`}>
        <h2 id={`leaving-${d.organizationId}`} className="font-display font-bold text-lg uppercase">
          Your coaching access with {d.organizationName} has ended
        </h2>
        <p className="font-body text-sm text-chalk mt-2">
          {d.fired ? "You were let go by the organization. " : "Your seven days are over. "}
          Your clients keep their records and can keep logging; nothing was deleted. {works ? `We emailed you a link to one export of everything for the clients you kept. It works for ${EXPORT_LINK_DAYS} days.` : "Your export link has expired."}
        </p>
        {works && (
          <p className="mt-3">
            <a href={`/api/coach/exit-export?organizationId=${d.organizationId}`} className="inline-flex items-center min-h-11 px-4 border border-steel/40 text-chalk font-body text-sm">
              Download my export
            </a>
          </p>
        )}
        {!works && supportEmail && (
          <p className="font-body text-xs text-steel mt-2">
            Questions: <a href={`mailto:${supportEmail}`} className="text-rust underline underline-offset-2">{supportEmail}</a>
          </p>
        )}
      </section>
    );
  }
  const left = daysLeftToChoose(d.since, now);
  return (
    <section className="mb-6 border border-rust/50 p-4" aria-labelledby={`leaving-${d.organizationId}`}>
      <h2 id={`leaving-${d.organizationId}`} className="font-display font-bold text-lg uppercase">
        You are leaving {d.organizationName}
      </h2>
      <p className="font-body text-sm text-chalk mt-2">
        Your clients are still with you and nothing has moved. You keep coaching them as you do today for {left} more day{left === 1 ? "" : "s"}, until {windowEndsAt(d.since).toLocaleDateString("en-US", { month: "long", day: "numeric" })}. Choose before then; after that your coaching access ends.
      </p>
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="border border-steel/25 p-3">
          <p className="font-body text-sm font-medium text-chalk">Keep my clients and everything: start my own account</p>
          <p className="font-body text-xs text-steel mt-1">Your clients, their history, programs and credits, your shop links, classes and calendar all move into an account you own. It starts on the standard free trial.</p>
          <StartOwnAccountButton organizationId={d.organizationId} organizationName={d.organizationName} />
        </div>
        <div className="border border-steel/25 p-3">
          <p className="font-body text-sm font-medium text-chalk">Export everything I have</p>
          <p className="font-body text-xs text-steel mt-1">A zip of spreadsheets with your clients, programs, workouts, sets, bookings, credits and notes.</p>
          <div className="mt-2">{d.exportGroupId ? <ExportBusinessButton groupId={d.exportGroupId} /> : <p className="font-body text-xs text-steel">Open one of your clients, then come back here to export.</p>}</div>
        </div>
      </div>
    </section>
  );
}
