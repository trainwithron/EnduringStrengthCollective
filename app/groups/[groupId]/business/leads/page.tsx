import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";

// equipment_qr_decal_scoping_sept19.md — where a gym_visitor_lead
// (a walk-in scanning an equipment QR code and expressing interest)
// actually surfaces for the coach, beyond just the one-time push
// notification. Org-wide data on a per-groupId route, same convention
// already used by Business/Waiver/Support on this shell.
export default async function LeadsPage(props: { params: Promise<{ groupId: string }> }) {
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
        <p className="font-body text-steel text-center">Only coaches can view leads.</p>
      </main>
    );
  }

  const { data: group } = await supabase
    .from("groups")
    .select("name, organization_id")
    .eq("id", params.groupId)
    .single();

  const { data: leads } = group?.organization_id
    ? await supabase
        .from("gym_visitor_leads")
        .select("id, full_name, contact_info, note, created_at, exercise_library ( name )")
        .eq("organization_id", group.organization_id)
        .order("created_at", { ascending: false })
    : { data: null };

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="leads">
      <div className="pb-6 border-b border-steel/20 mb-6">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">Leads</h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">
          Everyone who scanned an equipment QR code and said they&apos;re interested in joining.
        </p>
      </div>

      {!leads || leads.length === 0 ? (
        <p className="font-body text-sm text-steel">No leads yet.</p>
      ) : (
        <div className="divide-y divide-steel/15 max-w-2xl">
          {leads.map((lead: any) => (
            <div key={lead.id} className="py-4">
              <div className="flex items-center justify-between">
                <p className="font-body font-medium text-[15px]">{lead.full_name}</p>
                <p className="font-body text-xs text-steel">
                  {new Date(lead.created_at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </p>
              </div>
              <p className="font-body text-sm text-rust mt-0.5">{lead.contact_info}</p>
              {lead.exercise_library?.name && (
                <p className="font-body text-xs text-steel mt-1">
                  Scanned: {lead.exercise_library.name}
                </p>
              )}
              {lead.note && <p className="font-body text-sm text-chalk mt-1">{lead.note}</p>}
            </div>
          ))}
        </div>
      )}
    </CoachDesktopShell>
  );
}
