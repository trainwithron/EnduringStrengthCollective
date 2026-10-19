import Link from "next/link";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requestTargetFor } from "@/lib/client-requests";
import { RequestFlow } from "@/components/client-request/request-flow";

export const metadata = { title: "Request to train", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// Where "Request to train with me" on a coach's public page leads. READ ONLY: it looks the coach's page up and shows their name. Nothing about any client. Making an account or signing in happens here, and the last
// button sends a REQUEST that waits for the coach; nothing is granted until they approve it.
export default async function RequestToTrainPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const target = await requestTargetFor(createServiceRoleClient(), slug);
  if (!target) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6 text-center">
        <div>
          <h1 className="font-display uppercase text-2xl font-bold">This coach isn&apos;t taking requests here</h1>
          <p className="font-body text-steel text-sm mt-2 max-w-sm">The page may have changed. Ask the coach for their current link.</p>
          <Link href="/" className="inline-flex items-center justify-center h-11 px-6 mt-5 bg-rust text-graphite font-body text-sm font-medium">
            Go to Home
          </Link>
        </div>
      </main>
    );
  }
  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-10">
      <RequestFlow slug={target.slug} coachName={target.coachName} />
    </main>
  );
}
