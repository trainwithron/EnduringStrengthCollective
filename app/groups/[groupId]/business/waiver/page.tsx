import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { WaiverSettings } from "@/components/coach/desktop/waiver-settings";

export default async function WaiverPage(
  props: { params: Promise<{ groupId: string }> }
) {
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", params.groupId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (membership?.role !== "coach") {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">Only coaches can manage the client waiver.</p>
      </main>
    );
  }

  const { data: group } = await supabase
    .from("groups")
    .select("name, organization_id")
    .eq("id", params.groupId)
    .single();

  const { data: org } = await supabase
    .from("organizations")
    .select("id, waiver_text, waiver_pdf_path")
    .eq("id", group?.organization_id)
    .maybeSingle();

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="waiver">
      <div className="pb-6 border-b border-steel/20 mb-6">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">
          Client Waiver
        </h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">
          Every client added going forward completes a PAR-Q+ health screening and this waiver
          before they can reach the app. Edit the wording below or upload your own PDF.
        </p>
      </div>

      {org && (
        <WaiverSettings
          organizationId={org.id}
          initialWaiverText={org.waiver_text}
          initialWaiverPdfPath={org.waiver_pdf_path}
        />
      )}
    </CoachDesktopShell>
  );
}
