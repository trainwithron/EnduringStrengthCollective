import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { getCoachedGroups } from "@/lib/coach-groups";
import { loadMyDepartures } from "@/lib/leaving-coach";
import { supportEmail } from "@/lib/legal";
import { CoachHomeShell } from "@/components/coach/coach-home-shell";
import { LeavingCoachBanner } from "@/components/coach/leaving-coach-banner";

export const metadata = { title: "Leaving an organization" };

// Where a leaving coach's notices and pushes open (Ron, Nov 21: they opened Home, which on a phone is their own app, so the steps were never seen there): the same
// sections as the top of the computer's Home (lib/leaving-coach.ts), on any screen. Nothing to show: Home.
export default async function LeavingPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/leaving");

  const [departures, groups] = await Promise.all([loadMyDepartures(supabase, user.id), getCoachedGroups(supabase, user.id)]);
  const withExport = departures.map((d) => ({ ...d, exportGroupId: d.endedAt ? null : (groups.find((g) => g.orgId === d.organizationId)?.id ?? null) }));

  return (
    <CoachHomeShell orgName={departures[0]?.organizationName ?? "Your organization"}>
      {withExport.length > 0 ? (
        <LeavingCoachBanner departures={withExport} supportEmail={supportEmail()} />
      ) : (
        <div className="bg-surface rounded-card p-4 max-w-lg">
          <p className="font-body text-sm text-chalk">You are not leaving any organization.</p>
          <Link href="/coach-landing" className="mt-3 min-h-11 inline-flex items-center font-body text-sm text-rust-ink underline underline-offset-2">
            Go to Home
          </Link>
        </div>
      )}
    </CoachHomeShell>
  );
}
