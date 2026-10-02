import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { KioskPinManager } from "@/components/coach/desktop/kiosk-pin-manager";

// The admin surface for Kiosk Check-In — separate from the locked-down
// /kiosk screen itself on purpose: PINs are viewed/reset here, on the
// coach's own normal desktop session, never on the shared tablet that
// sits at the entrance (a PIN visible on that same screen would defeat
// the point of having one).
export default async function KioskSettingsPage(
  props: { params: Promise<{ groupId: string }> }
) {
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", params.groupId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (membership?.role !== "coach") {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">
          Only coaches can manage Kiosk Check-In.
        </p>
      </main>
    );
  }

  const { data: group } = await supabase
    .from("groups")
    .select("name")
    .eq("id", params.groupId)
    .maybeSingle();

  const { data: memberships } = await supabase
    .from("group_memberships")
    .select("profile_id, kiosk_pin, profiles ( full_name )")
    .eq("group_id", params.groupId)
    .eq("role", "athlete");

  const roster = (memberships ?? [])
    .map((m: any) => ({
      athleteId: m.profile_id as string,
      fullName: (m.profiles?.full_name as string | null) ?? "Unknown",
      kioskPin: m.kiosk_pin as string | null,
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="kiosk">
      <div className="pb-6 border-b border-steel/20 mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display font-bold text-3xl uppercase leading-none">Kiosk Check-In</h1>
          <p className="font-body text-sm text-steel mt-2">
            A tablet-friendly check-in screen for the entrance — set each athlete&apos;s 4-digit
            PIN here, then open Kiosk Mode on the shared device.
          </p>
        </div>
        <a
          href={`/groups/${params.groupId}/kiosk`}
          target="_blank"
          rel="noopener noreferrer"
          className="h-9 px-4 bg-rust text-graphite font-body text-sm font-medium flex items-center shrink-0"
        >
          Open Kiosk Mode →
        </a>
      </div>

      <KioskPinManager groupId={params.groupId} initialRoster={roster} />
    </CoachDesktopShell>
  );
}
