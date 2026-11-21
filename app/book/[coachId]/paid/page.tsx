import type { Metadata } from "next";
import { PaidBookingStatus } from "@/components/public/paid-booking-status";
import { cleanParam } from "@/lib/public-booking-route";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your booking", robots: { index: false, follow: false } };

// Deliberately public: where a visitor returns from paying on Stripe (wave 3 C7). The secret in the address is theirs alone; the page only shows how the booking went.
export default async function PaidPage(props: { params: Promise<{ coachId: string }>; searchParams: Promise<{ s?: string }> }) {
  const [{ coachId }, { s }] = await Promise.all([props.params, props.searchParams]);
  const slug = cleanParam(coachId.toLowerCase(), 40);
  return (
    <main className="min-h-screen bg-graphite text-chalk font-body">
      {slug && s ? (
        <PaidBookingStatus slug={slug} token={s} />
      ) : (
        <div className="max-w-lg mx-auto px-5 py-10">
          <h1 className="font-display font-bold text-3xl uppercase leading-none">We can&apos;t find this payment</h1>
          <p className="font-body text-base mt-4">Check your email for your booking.</p>
        </div>
      )}
    </main>
  );
}
