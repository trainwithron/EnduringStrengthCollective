import type { Metadata } from "next";
import { DiscoveryBookingFlow } from "@/components/public/discovery-booking-flow";
import { PublicBookingFlow } from "@/components/public/public-booking-flow";
import { getPublicPage } from "@/lib/public-booking-engine";
import { publicStore, cleanParam } from "@/lib/public-booking-route";
import { isUuid } from "@/lib/public-booking";
import { canSignProofs } from "@/lib/public-booking-proof";
import { isSendGridConfigured } from "@/lib/sendgrid";

export const dynamic = "force-dynamic";

// Deliberately public — a visitor booking has no account yet.
//
// This one address handles both kinds of link. A coach's own address ("/book/ron") shows their booking page: pick a session
// type and a time from their real calendar, no account needed (see lib/public-booking-engine.ts). The older id link
// ("/book/<coach id>") keeps working exactly as before and shows the discovery-call booking (see
// app/api/discovery-availability/[coachId]/route.ts and the book_discovery_call function, migration 0089).
async function pageFor(param: string) {
  const slug = cleanParam(param.toLowerCase(), 40);
  if (!slug) return null;
  // Booking confirms each visitor's email with a code, so with no email sender set up the page stays closed.
  if (!canSignProofs() || !isSendGridConfigured()) return { slug, view: null };
  return { slug, view: await getPublicPage(publicStore(), slug) };
}

export async function generateMetadata(props: { params: Promise<{ coachId: string }> }): Promise<Metadata> {
  const { coachId } = await props.params;
  if (isUuid(coachId)) return { title: "Book a call" };
  const found = await pageFor(coachId);
  return { title: found?.view ? `Book with ${found.view.coachName}` : "Booking page" };
}

export default async function BookPage(props: { params: Promise<{ coachId: string }> }) {
  const { coachId } = await props.params;

  if (isUuid(coachId)) {
    return (
      <main className="min-h-screen bg-graphite text-chalk font-body">
        <DiscoveryBookingFlow coachId={coachId} />
      </main>
    );
  }

  const found = await pageFor(coachId);
  if (!found?.view) {
    return (
      <main className="min-h-screen bg-graphite text-chalk font-body flex items-center justify-center px-6">
        <div className="max-w-sm text-center">
          <h1 className="font-display font-bold text-2xl uppercase">This booking page isn&apos;t available</h1>
          <p className="font-body text-sm text-steel mt-3">The link may be wrong, or the coach hasn&apos;t switched online booking on yet.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body">
      <PublicBookingFlow slug={found.slug} page={found.view} />
    </main>
  );
}
