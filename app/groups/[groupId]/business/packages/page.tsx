import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { PackageManager, type CoachPackageRow } from "@/components/coach/desktop/package-manager";

export default async function PackagesPage(
  props: {
    params: Promise<{ groupId: string }>;
  }
) {
  const params = await props.params;
  const supabase = createServerClient();
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
        <p className="font-body text-steel text-center">Only coaches can manage packages.</p>
      </main>
    );
  }

  const { data: group } = await supabase
    .from("groups")
    .select("name")
    .eq("id", params.groupId)
    .single();

  const { data: packageRows } = await supabase
    .from("coach_packages")
    .select("id, name, sessions_per_week, billing_type, sessions_granted, rate_cents, is_active, is_public")
    .eq("coach_id", user.id)
    .eq("group_id", params.groupId)
    .order("sessions_per_week", { ascending: true });

  const packages: CoachPackageRow[] = (packageRows ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    sessionsPerWeek: p.sessions_per_week,
    billingType: p.billing_type as "subscription" | "one_time",
    sessionsGranted: p.sessions_granted,
    isPublic: p.is_public,
    rateCents: p.rate_cents,
    isActive: p.is_active,
  }));

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="packages">
      <div className="pb-6 border-b border-steel/20 mb-6">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">Packages</h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">
          Define what you actually sell — a client sees these on their Billing page. Editing a
          package&apos;s rate never changes what an existing subscriber is already paying.
        </p>
      </div>

      <PackageManager groupId={params.groupId} initialPackages={packages} />
    </CoachDesktopShell>
  );
}
