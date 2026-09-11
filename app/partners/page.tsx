import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/group/sign-out-button";
import { TrainingPartnerProfileEditor } from "@/components/athlete/training-partner-profile-editor";
import { TrainingPartnerBrowseList, type BrowseProfile } from "@/components/athlete/training-partner-browse-list";

export default async function TrainingPartnersPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: isCoachAnywhere } = await supabase
    .from("group_memberships")
    .select("group_id")
    .eq("profile_id", user.id)
    .eq("role", "coach")
    .limit(1)
    .maybeSingle();

  if (isCoachAnywhere) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">
          Training partner matching is for athletes only.
        </p>
      </main>
    );
  }

  const { data: myGroup } = await supabase
    .from("group_memberships")
    .select("group_id")
    .eq("profile_id", user.id)
    .eq("role", "athlete")
    .limit(1)
    .maybeSingle();

  const { data: myProfileRow } = await supabase
    .from("training_partner_profiles")
    .select("visible, location_text, looking_for")
    .eq("athlete_id", user.id)
    .maybeSingle();

  const { data: visibleRows } = await supabase
    .from("training_partner_profiles")
    .select("athlete_id, location_text, looking_for, profiles ( full_name )")
    .neq("athlete_id", user.id);

  const browseProfiles: BrowseProfile[] = (visibleRows ?? []).map((row: any) => ({
    athleteId: row.athlete_id,
    fullName: row.profiles?.full_name ?? "Athlete",
    locationText: row.location_text,
    lookingFor: row.looking_for,
  }));

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body px-5 py-10 pb-24">
      <div className="max-w-lg mx-auto">
        <div className="flex items-center justify-between mb-4">
          <Link
            href={myGroup ? `/groups/${myGroup.group_id}/settings` : "/login"}
            className="font-body text-xs text-steel uppercase tracking-wide"
          >
            &larr; Back to settings
          </Link>
          <SignOutButton />
        </div>
        <h1 className="font-display font-bold text-3xl uppercase leading-none mb-2">
          Training Partners
        </h1>
        <p className="font-body text-sm text-steel mb-6">
          Find someone to train with — anyone opted in, regardless of who coaches them. Couples
          who train together are far more likely to stick with it than training alone.
        </p>

        <div className="mb-8">
          <TrainingPartnerProfileEditor
            athleteId={user.id}
            initial={{
              visible: myProfileRow?.visible ?? false,
              locationText: myProfileRow?.location_text ?? "",
              lookingFor: myProfileRow?.looking_for ?? "",
            }}
          />
        </div>

        <Link
          href="/partners/requests"
          className="font-body text-sm text-rust block mb-6"
        >
          View your requests &amp; matches →
        </Link>

        {myProfileRow?.visible ? (
          <section>
            <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-3">
              Looking for a partner
            </h2>
            <TrainingPartnerBrowseList profiles={browseProfiles} myAthleteId={user.id} />
          </section>
        ) : (
          <p className="font-body text-sm text-steel">
            Turn on visibility above to browse other athletes looking for a training partner.
          </p>
        )}
      </div>
    </main>
  );
}
