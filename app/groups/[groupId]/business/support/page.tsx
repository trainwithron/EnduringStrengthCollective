import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { SupportInbox, type SupportRequestRow } from "@/components/coach/desktop/support-inbox";

export default async function SupportPage(
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
        <p className="font-body text-steel text-center">Only coaches can use support.</p>
      </main>
    );
  }

  const { data: group } = await supabase
    .from("groups")
    .select("name, organization_id")
    .eq("id", params.groupId)
    .single();

  const organizationId = group?.organization_id;

  const { data: requestRows } = organizationId
    ? await supabase
        .from("support_requests")
        .select("id, subject, status, support_messages ( id, author_id, body, created_at, profiles ( full_name ) )")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
    : { data: null };

  const requests: SupportRequestRow[] = (requestRows ?? []).map((r: any) => ({
    id: r.id,
    subject: r.subject,
    status: r.status,
    messages: (r.support_messages ?? [])
      .slice()
      .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .map((m: any) => ({
        id: m.id,
        authorId: m.author_id,
        authorName: m.author_id === user.id ? "You" : m.profiles?.full_name ?? "Support",
        body: m.body,
        createdAt: m.created_at,
      })),
  }));

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="support">
      <div className="pb-6 border-b border-steel/20 mb-6">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">Support</h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">
          Billing questions, bugs, anything else — a message here reaches Ron directly and stays
          on the record, instead of getting lost in a personal inbox.
        </p>
      </div>

      {organizationId && (
        <SupportInbox organizationId={organizationId} coachId={user.id} initialRequests={requests} />
      )}
    </CoachDesktopShell>
  );
}
