import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { NoAccess } from "@/components/shared/no-access";
import { LoadFailedPage } from "@/components/ui/load-failed-page";
import { isReadFailure } from "@/lib/read-failed";
import { authorizeInviteManager, inviteLinkProbablyDead, shortDate, signInFacts, signInWords } from "@/lib/coach-invite-server";
import { loadOrgCoaches } from "@/lib/pending-coaches";
import { PendingInviteActions } from "@/components/org/pending-invite-actions";
import { SendSignInLink } from "@/components/org/send-sign-in-link";

export const metadata = { title: "Coach" };

const ROLE_WORD: Record<string, string> = { owner: "Owner", admin: "Admin", coach: "Coach", front_desk: "Front desk" };

// A coach's page: who they are, what they do here, and (for an organization owner or admin) how to reach them and how to get them signed in. Reached from the Coaches list. Any coach of the group sees the name, role and
// groups; the contact email and the sign-in facts and actions are for an owner or admin of the organization only. A person who is not one of this organization's coaches is "not found", whatever the address says.
export default async function CoachProfilePage(props: { params: Promise<{ groupId: string; profileId: string }> }) {
  const { groupId, profileId } = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: mine, error: mineError } = await supabase.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", user.id).maybeSingle();
  if (isReadFailure(mineError)) return <LoadFailedPage />;
  if (mine?.role !== "coach") return <NoAccess>Only coaches of this group can see a coach&apos;s page.</NoAccess>;

  const [{ data: group }, list, manager] = await Promise.all([
    supabase.from("groups").select("name").eq("id", groupId).maybeSingle(),
    loadOrgCoaches(groupId),
    authorizeInviteManager(supabase, user.id, groupId),
  ]);
  const coach = list.coaches.find((c) => c.profileId === profileId);
  if (!list.organizationId || !coach) notFound();

  const db = createServiceRoleClient();
  const [{ data: seats }, { data: orgRow }] = await Promise.all([
    // the shared groups they coach (a coach also has a seat in each client's own space; those are not listed, they would give away client names)
    db.from("group_memberships").select("groups!inner ( id, name, group_kind, organization_id )").eq("profile_id", profileId).eq("role", "coach").eq("groups.organization_id", list.organizationId),
    db.from("organization_memberships").select("created_at").eq("organization_id", list.organizationId).eq("profile_id", profileId).maybeSingle(),
  ]);
  type G = { id: string; name: string; group_kind: string | null };
  const groups = ((seats ?? []) as unknown as { groups: G | G[] | null }[])
    .map((s) => (Array.isArray(s.groups) ? s.groups[0] : s.groups))
    .filter((g): g is G => !!g && g.group_kind !== "one_on_one")
    .sort((a, b) => a.name.localeCompare(b.name));

  const isSelf = profileId === user.id;
  let email: string | null = null;
  let facts = null as ReturnType<typeof signInFacts> | null;
  if (manager.ok) {
    const { data } = await db.auth.admin.getUserById(profileId);
    email = data?.user?.email ?? null;
    if (data?.user) facts = signInFacts(data.user);
  }
  const pending = list.pending.find((p) => p.profileId === profileId);
  const initials = coach.fullName
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <CoachDesktopShell groupId={groupId} groupName={group?.name ?? "Group"} active="clients">
      <div className="max-w-2xl space-y-6">
        <p className="font-body text-sm">
          <Link href={`/groups/${groupId}/clients`} className="text-steel underline underline-offset-2">
            Back to the Coaches list
          </Link>
        </p>

        <div className="flex items-center gap-4">
          {coach.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={coach.avatarUrl} alt="" className="w-16 h-16 rounded-full object-cover" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-surface border border-steel/30 flex items-center justify-center">
              <span className="font-display text-xl text-chalk">{initials}</span>
            </div>
          )}
          <div>
            <h1 className="font-display font-bold text-3xl uppercase leading-none">{coach.fullName}</h1>
            <p className="font-body text-sm text-rust mt-1">
              {ROLE_WORD[coach.orgRole] ?? "Coach"}
              {isSelf && <span className="text-steel ml-2">You</span>}
            </p>
          </div>
        </div>

        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 font-body text-sm">
          <dt className="text-steel">Coaches</dt>
          <dd>{groups.length === 0 ? "No groups yet" : groups.map((g, i) => <span key={g.id}>{i > 0 && ", "}<Link href={`/groups/${g.id}/clients`} className="underline underline-offset-2">{g.name}</Link></span>)}</dd>
          {orgRow?.created_at && (
            <>
              <dt className="text-steel">Joined</dt>
              <dd>{shortDate(orgRow.created_at as string)}</dd>
            </>
          )}
          {manager.ok && (
            <>
              <dt className="text-steel">Email</dt>
              <dd>{email ? <a href={`mailto:${email}`} className="underline underline-offset-2">{email}</a> : "Not available"}</dd>
              {facts && (
                <>
                  <dt className="text-steel">Sign-in</dt>
                  <dd>{signInWords(facts)}</dd>
                </>
              )}
            </>
          )}
        </dl>

        {manager.ok && !isSelf && coach.orgRole !== "owner" && (
          <section aria-label="Sign-in" className="border border-steel/20 p-4 space-y-2">
            <h2 className="font-display uppercase text-lg tracking-wide">Sign-in</h2>
            <div className="flex flex-wrap items-center gap-x-4">
              {pending ? (
                <PendingInviteActions groupId={groupId} profileId={pending.profileId} name={pending.name} email={pending.email} />
              ) : (
                <SendSignInLink groupId={groupId} profileId={profileId} name={coach.fullName} />
              )}
            </div>
            {pending && facts && inviteLinkProbablyDead(facts) && <p className="font-body text-xs text-rust">That link expired or was already used. Send a new one.</p>}
            {!pending && <p className="font-body text-xs text-steel">A link goes to their own email address. You never see it.</p>}
          </section>
        )}
      </div>
    </CoachDesktopShell>
  );
}
