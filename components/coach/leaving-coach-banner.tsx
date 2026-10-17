import { ExportBusinessButton } from "@/components/coach/desktop/export-business-button";
import type { MyDeparture } from "@/lib/leaving-coach";

// Shown at the top of a leaving coach's Home. Nothing has moved: they still coach their clients as before, and they choose between starting their own account (not open yet) and taking a copy of everything.
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
  const exportGroupId = d.exportGroupId;
  return (
    <section className="mb-6 border border-rust/50 p-4" aria-labelledby={`leaving-${d.organizationId}`}>
      <h2 id={`leaving-${d.organizationId}`} className="font-display font-bold text-lg uppercase">
        You are leaving {d.organizationName}
      </h2>
      <p className="font-body text-sm text-chalk mt-2">
        Your clients are still with you and nothing has moved. You keep coaching them as you do today. When you are ready, choose what happens next.
      </p>
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="border border-steel/25 p-3">
          <p className="font-body text-sm font-medium text-chalk">Keep my clients and everything: start my own account</p>
          <p className="font-body text-xs text-steel mt-1">Your clients, their history, programs and credits, your shop links, classes and calendar all move into an account you own.</p>
          <p className="font-body text-sm text-chalk mt-2">
            Coming soon:{" "}
            {supportEmail ? (
              <a href={`mailto:${supportEmail}`} className="text-rust underline underline-offset-2">
                email us
              </a>
            ) : (
              "email us"
            )}
            {supportEmail ? " and we will set it up with you." : "."}
          </p>
        </div>
        <div className="border border-steel/25 p-3">
          <p className="font-body text-sm font-medium text-chalk">Export everything I have</p>
          <p className="font-body text-xs text-steel mt-1">A zip of spreadsheets with your clients, programs, workouts, sets, bookings, credits and notes.</p>
          <div className="mt-2">{exportGroupId ? <ExportBusinessButton groupId={exportGroupId} /> : <p className="font-body text-xs text-steel">Open one of your clients, then come back here to export.</p>}</div>
        </div>
      </div>
    </section>
  );
}
