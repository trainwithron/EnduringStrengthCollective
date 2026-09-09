import { DiscoveryBookingFlow } from "@/components/public/discovery-booking-flow";

// Deliberately public — a prospect booking a discovery call has no
// account yet. See app/api/discovery-availability/[coachId]/route.ts for
// how this reads a coach's real schedule without any new anon RLS
// policies, and the book_discovery_call RPC (migration 0089) for the one
// narrow anon write this page needs.
export default async function BookDiscoveryCallPage(
  props: {
    params: Promise<{ coachId: string }>;
  }
) {
  const params = await props.params;
  return (
    <main className="min-h-screen bg-graphite text-chalk font-body">
      <DiscoveryBookingFlow coachId={params.coachId} />
    </main>
  );
}
