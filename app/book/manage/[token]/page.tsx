import type { Metadata } from "next";
import { ManageBookingFlow } from "@/components/public/manage-booking-flow";
import { getManagedBooking } from "@/lib/public-booking-engine";
import { cleanParam, publicStore } from "@/lib/public-booking-route";

export const dynamic = "force-dynamic";

// A private link: never indexed, never cached.
export const metadata: Metadata = { title: "Your booking", robots: { index: false, follow: false } };

export default async function ManageBookingPage(props: { params: Promise<{ token: string }> }) {
  const { token: raw } = await props.params;
  const token = cleanParam(raw, 100);
  const view = token ? await getManagedBooking(publicStore(), token) : null;

  if (!token || !view || !view.ok) {
    return (
      <main className="min-h-screen bg-graphite text-chalk font-body flex items-center justify-center px-6">
        <div className="max-w-sm text-center">
          <h1 className="font-display font-bold text-2xl uppercase">This link isn&apos;t valid</h1>
          <p className="font-body text-sm text-steel mt-3">Check that you copied the whole link, or ask your coach for a new one.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body">
      <ManageBookingFlow
        token={token}
        coachName={view.coachName}
        typeName={view.typeName}
        startIso={view.startIso}
        timezone={view.timezone}
        status={view.status}
        canChange={view.canChange}
        reason={view.reason}
        guestName={view.guestName}
      />
    </main>
  );
}
