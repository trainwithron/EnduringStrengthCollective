import { runPool } from "@/lib/run-pool";

// Invitations of people who had NO account: the auth account is made when the invitation is sent, so "not accepted yet" is "never confirmed and never signed in". The Team page lists them, and the owner or an
// admin can send the link again, copy it, or cancel. Everything here runs with the server key, after the caller has been checked as an owner or admin of the organization (authorizeInviteManager).

export interface PendingInvitee {
  profileId: string;
  name: string;
  email: string;
  role: string; // owner is never listed; admin, coach, front_desk
  sentAt: string | null;
}

export interface Manager {
  organizationId: string;
  callerName: string | null;
}

/** The caller must be an owner or admin of the organization the group belongs to. Returns the organization, or a short reason. */
export async function authorizeInviteManager(supabase: any, userId: string, groupId: string): Promise<{ ok: true; manager: Manager } | { ok: false; status: number; error: string }> {
  if (!groupId) return { ok: false, status: 400, error: "Missing the group." };
  const { data: group } = await supabase.from("groups").select("organization_id").eq("id", groupId).maybeSingle();
  if (!group?.organization_id) return { ok: false, status: 400, error: "This group isn't part of an organization." };
  const { data: mine } = await supabase.from("organization_memberships").select("role").eq("organization_id", group.organization_id).eq("profile_id", userId).maybeSingle();
  if (mine?.role !== "owner" && mine?.role !== "admin") return { ok: false, status: 403, error: "Only an organization owner or admin can manage invitations." };
  const { data: me } = await supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle();
  return { ok: true, manager: { organizationId: group.organization_id, callerName: (me as { full_name?: string | null } | null)?.full_name ?? null } };
}

/** An auth account that has never been confirmed and never signed in is an invitation nobody has accepted. */
export function isUnaccepted(user: { email_confirmed_at?: string | null; last_sign_in_at?: string | null } | null | undefined): boolean {
  return !!user && !user.email_confirmed_at && !user.last_sign_in_at;
}

/** Which of these organization people (members and front desk) have not accepted yet. A person whose account cannot be read is left out (never listed as pending on a guess). */
export async function loadPendingInvitees(serviceRole: any, people: { profileId: string; name: string; role: string }[]): Promise<PendingInvitee[]> {
  const found: PendingInvitee[] = [];
  await runPool(people, 8, async (p) => {
    const { data } = await serviceRole.auth.admin.getUserById(p.profileId);
    const user = data?.user;
    if (!isUnaccepted(user) || !user?.email) return;
    found.push({ profileId: p.profileId, name: p.name, email: user.email as string, role: p.role, sentAt: (user.invited_at ?? user.confirmation_sent_at ?? user.created_at ?? null) as string | null });
  });
  return found.sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? ""));
}

/** The person must belong to the organization (as a member or front desk) and must not have accepted yet. */
export async function loadInviteTarget(
  serviceRole: any,
  organizationId: string,
  profileId: string
): Promise<{ ok: true; email: string; name: string; role: string } | { ok: false; status: number; error: string }> {
  if (!profileId) return { ok: false, status: 400, error: "Missing the person." };
  const [{ data: member }, { data: desk }] = await Promise.all([
    serviceRole.from("organization_memberships").select("role").eq("organization_id", organizationId).eq("profile_id", profileId).maybeSingle(),
    serviceRole.from("org_front_desk").select("profile_id").eq("organization_id", organizationId).eq("profile_id", profileId).maybeSingle(),
  ]);
  if (!member && !desk) return { ok: false, status: 404, error: "That invitation was not found." };
  if (member?.role === "owner") return { ok: false, status: 404, error: "That invitation was not found." };
  const { data } = await serviceRole.auth.admin.getUserById(profileId);
  const user = data?.user;
  if (!user?.email) return { ok: false, status: 404, error: "That invitation was not found." };
  if (!isUnaccepted(user)) return { ok: false, status: 409, error: "They have already accepted, so there is nothing to send. They can sign in, or use Forgot password." };
  const { data: profile } = await serviceRole.from("profiles").select("full_name").eq("id", profileId).maybeSingle();
  return { ok: true, email: user.email as string, name: (profile as { full_name?: string | null } | null)?.full_name ?? "", role: member?.role ?? "front_desk" };
}
