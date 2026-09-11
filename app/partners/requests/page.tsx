import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/group/sign-out-button";
import {
  TrainingPartnerRequestsPanel,
  type PartnerRequestRow,
} from "@/components/athlete/training-partner-requests-panel";

export default async function TrainingPartnerRequestsPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: rows } = await supabase
    .from("training_partner_requests")
    .select(
      "id, from_athlete_id, to_athlete_id, status, message, response_message, from_profile:profiles!training_partner_requests_from_athlete_id_fkey ( full_name ), to_profile:profiles!training_partner_requests_to_athlete_id_fkey ( full_name )"
    )
    .or(`from_athlete_id.eq.${user.id},to_athlete_id.eq.${user.id}`)
    .order("created_at", { ascending: false });

  const mapped: PartnerRequestRow[] = (rows ?? []).map((r: any) => ({
    id: r.id,
    fromAthleteId: r.from_athlete_id,
    toAthleteId: r.to_athlete_id,
    fromName: r.from_profile?.full_name ?? "Athlete",
    toName: r.to_profile?.full_name ?? "Athlete",
    status: r.status,
    message: r.message,
    responseMessage: r.response_message,
  }));

  const incoming = mapped.filter((r) => r.toAthleteId === user.id && r.status === "pending");
  const outgoing = mapped.filter((r) => r.fromAthleteId === user.id);
  const matched = mapped.filter((r) => r.status === "accepted");

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body px-5 py-10 pb-24">
      <div className="max-w-lg mx-auto">
        <div className="flex items-center justify-between mb-4">
          <Link href="/partners" className="font-body text-xs text-steel uppercase tracking-wide">
            &larr; Back to training partners
          </Link>
          <SignOutButton />
        </div>
        <h1 className="font-display font-bold text-3xl uppercase leading-none mb-6">
          Requests
        </h1>

        <TrainingPartnerRequestsPanel
          myAthleteId={user.id}
          incoming={incoming}
          outgoing={outgoing}
          matched={matched}
        />
      </div>
    </main>
  );
}
