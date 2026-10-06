import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { NoAccess } from "@/components/shared/no-access";
import { OrgTrainerRequestForm } from "@/components/public/org-trainer-request-form";

// org_calendar_spotter_trainer_dispatch_scoping_sept19.md — a forward-
// facing org-level intake page, parallel to (not replacing) the
// existing single-coach /book/[coachId] flow. Deliberately public — a
// prospect has no account yet, same trust model as /book/[coachId].
export default async function JoinOrgPage(props: { params: Promise<{ orgSlug: string }> }) {
  const params = await props.params;
  const supabase = createServiceRoleClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("id, display_name, name")
    .eq("slug", params.orgSlug)
    .maybeSingle();

  if (!org) {
    return (
      <NoAccess>This page isn&apos;t available.</NoAccess>
    );
  }

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body">
      <OrgTrainerRequestForm organizationId={org.id} orgName={org.display_name ?? org.name} />
    </main>
  );
}
