import { runPool } from "@/lib/run-pool";

// Invitations of people who had NO account: the auth account is made when the invitation is sent, so "not accepted yet" is "carries our invitation marker (invited_at), never confirmed and never signed in". The Team
// page lists them, and the owner or an admin can send the link again, copy it, or cancel. Everything here runs with the server key, after the caller has been checked as an owner or admin of the organization
// (authorizeInviteManager). An account that was created some other way (seeded, made by an administrator) has no invitation marker and is never treated as an invitation.

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

type AuthUserLike = { email_confirmed_at?: string | null; last_sign_in_at?: string | null; invited_at?: string | null } | null | undefined;

/** An invitation nobody has accepted: our invitation marker is on the account and it has never been confirmed or signed in. */
export function isUnaccepted(user: AuthUserLike): boolean {
  return !!user && !!user.invited_at && !user.email_confirmed_at && !user.last_sign_in_at;
}

/** Which of these organization people (members and front desk) have not accepted yet. A person whose account cannot be read, or whose account carries no invitation marker, is left out (never listed on a guess). */
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

export const RESEND_COOLDOWN_SECONDS = 600;

/** Was a send of this kind made for this account in the last ten minutes? Read from the account itself, written only AFTER a send succeeded, so a failed attempt never locks anybody out. */
export function sentRecently(appMetadata: Record<string, unknown> | null | undefined, field: "invite_emailed_at" | "invite_link_made_at", nowMs: number = Date.now()): boolean {
  const at = appMetadata?.[field];
  const ms = typeof at === "string" ? Date.parse(at) : NaN;
  return Number.isFinite(ms) && nowMs - ms < RESEND_COOLDOWN_SECONDS * 1000;
}

export async function markSent(serviceRole: any, userId: string, appMetadata: Record<string, unknown> | null | undefined, field: "invite_emailed_at" | "invite_link_made_at", nowMs: number = Date.now()): Promise<void> {
  await serviceRole.auth.admin.updateUserById(userId, { app_metadata: { ...(appMetadata ?? {}), [field]: new Date(nowMs).toISOString() } });
}

/** An account made by an invitation that then failed half way: removed when it is still an unaccepted invitation (never one that has been used). */
export async function removeOrphanInvitee(serviceRole: any, userId: string): Promise<void> {
  try {
    const { data } = await serviceRole.auth.admin.getUserById(userId);
    if (isUnaccepted(data?.user)) await serviceRole.auth.admin.deleteUser(userId);
  } catch {
    // Best effort: a leftover unaccepted account is listed under Invitations (if it has a seat) and can be cancelled there.
  }
}

/** The person must belong to the organization (as a member or front desk) and must not have accepted yet. */
export async function loadInviteTarget(
  serviceRole: any,
  organizationId: string,
  profileId: string
): Promise<{ ok: true; email: string; name: string; role: string; appMetadata: Record<string, unknown> } | { ok: false; status: number; error: string }> {
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
  return {
    ok: true,
    email: user.email as string,
    name: (profile as { full_name?: string | null } | null)?.full_name ?? "",
    role: member?.role ?? "front_desk",
    appMetadata: ((user.app_metadata ?? {}) as Record<string, unknown>),
  };
}
