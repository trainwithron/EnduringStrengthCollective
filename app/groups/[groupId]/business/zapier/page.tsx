import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { ZapierSettings } from "@/components/coach/desktop/zapier-settings";

export default async function ZapierPage(props: { params: Promise<{ groupId: string }> }) {
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
        <p className="font-body text-steel text-center">Only coaches can manage the Zapier integration.</p>
      </main>
    );
  }

  const { data: group } = await supabase.from("groups").select("name").eq("id", params.groupId).single();

  const { data: subscriptions } = await supabase
    .from("webhook_subscriptions")
    .select("id, event_type, target_url, created_at")
    .eq("coach_id", user.id);

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="zapier">
      <div className="pb-6 border-b border-steel/20 mb-6">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">Zapier</h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">
          Connect a new client, completed workout, PR, or package purchase to thousands of other
          apps through Zapier — spreadsheets, CRMs, email marketing, and more.
        </p>
      </div>

      <ZapierSettings initialSubscriptions={subscriptions ?? []} />
    </CoachDesktopShell>
  );
}
