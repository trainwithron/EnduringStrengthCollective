import { redirect } from "next/navigation";
import { redirectOneOnOneToAnchor } from "@/lib/coach-wide-redirect";
import { NoAccess } from "@/components/shared/no-access";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { SmsSettingsForm } from "@/components/coach/desktop/sms-settings-form";
import { isTwilioConfigured } from "@/lib/twilio";

export default async function SmsSettingsPage(
  props: { params: Promise<{ groupId: string }> }
) {
  const params = await props.params;
  await redirectOneOnOneToAnchor(params.groupId, "business/sms-settings");
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
      <NoAccess>Only coaches can manage SMS settings.</NoAccess>
    );
  }

  const { data: group } = await supabase.from("groups").select("name").eq("id", params.groupId).single();

  const { data: config } = await supabase
    .from("coach_sms_config")
    .select("phone, sms_enabled, quiet_hours_start, quiet_hours_end")
    .eq("coach_id", user.id)
    .maybeSingle();

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="sms-settings">
      <div className="pb-6 border-b border-steel/20 mb-6">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">SMS Notifications</h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">
          Session reminders, booking confirmations, attendance nudges, and low-credit alerts, sent
          as real text messages alongside the push notifications you already get.
        </p>
      </div>

      <SmsSettingsForm
        coachId={user.id}
        initialPhone={config?.phone ?? null}
        initialSmsEnabled={config?.sms_enabled ?? false}
        initialQuietHoursStart={config?.quiet_hours_start ?? null}
        initialQuietHoursEnd={config?.quiet_hours_end ?? null}
        smsAvailable={isTwilioConfigured()}
      />
    </CoachDesktopShell>
  );
}
