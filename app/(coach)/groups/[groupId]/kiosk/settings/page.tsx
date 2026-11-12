import { LoadFailedPage } from "@/components/ui/load-failed-page";
import { isReadFailure } from "@/lib/read-failed";
import { redirect } from "next/navigation";
import { NoAccess } from "@/components/shared/no-access";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { KioskPinManager, type KioskRosterEntry } from "@/components/coach/desktop/kiosk-pin-manager";
import { KioskModeSwitch, type KioskMode } from "@/components/coach/desktop/kiosk-mode-switch";
import { CardCsvImport } from "@/components/coach/desktop/card-csv-import";
import { loadKioskPinStatus } from "@/lib/kiosk-pin-status";

export const metadata = { title: "Settings" };

// The admin surface for Kiosk Check-In — separate from the locked-down
// /kiosk screen itself on purpose: PINs are viewed/reset here, on the
// coach's own normal desktop session, never on the shared tablet that
// sits at the entrance (a PIN visible on that same screen would defeat
// the point of having one).
// Step 198 (Ron, Nov 2): the tablet is either this group's check-in (a class or a team) or the whole organization's front desk, picked at the top; in front-desk mode every
// client of the organization is listed here, with their PIN and their key card, and a member export brings every card over at once.
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

  const { data: membership, error: membershipError } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", params.groupId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (isReadFailure(membershipError)) return <LoadFailedPage />;

  if (membership?.role !== "coach") {
    return (
      <NoAccess>Only coaches can manage Kiosk Check-In.</NoAccess>
    );
  }

  // Independent reads, together (Nov 2: they ran one after another). The mode is read on its own, so a database without step 198 yet still shows the page (in group mode).
  const [{ data: group }, { data: modeRow, error: modeError }, { data: memberships }, pinStatus] = await Promise.all([
    supabase.from("groups").select("name, organization_id, organizations ( name )").eq("id", params.groupId).maybeSingle(),
    supabase.from("groups").select("kiosk_mode").eq("id", params.groupId).maybeSingle(),
    supabase.from("group_memberships").select("profile_id, profiles ( full_name )").eq("group_id", params.groupId).eq("role", "athlete"),
    loadKioskPinStatus(supabase, params.groupId),
  ]);
  const cardsReady = !modeError;
  const mode: KioskMode = (modeRow as { kiosk_mode?: string } | null)?.kiosk_mode === "front_desk" ? "front_desk" : "group";
  const organizationId = (group?.organization_id as string | null) ?? null;
  const orgName = ((group as { organizations?: { name?: string } | null } | null)?.organizations?.name as string | undefined) ?? "your organization";

  let roster: KioskRosterEntry[];
  let rosterFailed = false;
  if (mode === "front_desk" && organizationId) {
    const { data: rows, error } = await supabase.rpc("kiosk_settings_roster", { p_org: organizationId });
    rosterFailed = !!error;
    roster = ((rows ?? []) as { athlete_id: string; group_id: string; group_name: string; full_name: string; has_pin: boolean; has_card: boolean }[]).map((r) => ({
      athleteId: r.athlete_id,
      groupId: r.group_id,
      groupName: r.group_name,
      fullName: r.full_name,
      hasPin: r.has_pin,
      hasCard: r.has_card,
    }));
  } else {
    const ids = (memberships ?? []).map((m: any) => m.profile_id as string);
    const { data: cardRows } = cardsReady && organizationId && ids.length > 0 ? await supabase.from("checkin_cards").select("athlete_id").eq("organization_id", organizationId).in("athlete_id", ids) : { data: [] };
    const withCard = new Set(((cardRows ?? []) as { athlete_id: string }[]).map((r) => r.athlete_id));
    roster = (memberships ?? [])
      .map((m: any) => ({
        athleteId: m.profile_id as string,
        groupId: params.groupId,
        fullName: (m.profiles?.full_name as string | null) ?? "Unknown",
        hasPin: pinStatus.get(m.profile_id as string) ?? false,
        hasCard: withCard.has(m.profile_id as string),
      }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  const openHref = mode === "front_desk" && organizationId ? `/front-desk?org=${organizationId}` : `/groups/${params.groupId}/kiosk`;

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="kiosk">
      <div className="pb-6 border-b border-steel/20 mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display font-bold text-3xl uppercase leading-none">Kiosk Check-In</h1>
          <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">
            A tablet-friendly check-in screen for the entrance. Give each person a 4-digit PIN or link their key card here, then open Kiosk Mode on the shared device. A barcode
            scanner plugged into or paired with the tablet checks people in when they scan their card.
          </p>
        </div>
        <a
          href={openHref}
          target="_blank"
          rel="noopener noreferrer"
          className="h-9 px-4 bg-rust text-graphite font-body text-sm font-medium flex items-center shrink-0"
        >
          Open Kiosk Mode →
        </a>
      </div>

      {cardsReady && organizationId && <KioskModeSwitch groupId={params.groupId} groupName={group?.name ?? "this group"} orgName={orgName} initialMode={mode} />}

      {cardsReady && organizationId && mode === "front_desk" && <CardCsvImport organizationId={organizationId} />}

      {rosterFailed ? (
        <p className="font-body text-sm text-rust" role="alert">
          The client list could not be read. Reload to try again.
        </p>
      ) : (
        <KioskPinManager
          key={mode}
          initialRoster={roster}
          organizationId={cardsReady ? organizationId : null}
          showGroup={mode === "front_desk"}
          // A group with no one in it directly (one-on-one clients each have their own space): the way to list them all is the front-desk choice above (Ron, Nov 12).
          emptyNote={mode === "group" && cardsReady && organizationId ? `No one is in this group itself. To list every client in ${orgName}, pick Everyone (front desk) above.` : undefined}
        />
      )}
    </CoachDesktopShell>
  );
}
