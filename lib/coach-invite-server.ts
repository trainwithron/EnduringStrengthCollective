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

export type SignInState = "unaccepted" | "signed_in" | "never";
export interface SignInFacts {
  state: SignInState;
  lastSignInAt: string | null;
  /** when the newest invitation email or link for this account was made (an unaccepted account only) */
  linkMadeAt: string | null;
  /** signed in within ten minutes of an invitation link being made: most likely an email scanner or a message preview opened it, not the person */
  signedInRightAfterLink: boolean;
}

/** In words an owner can read: an invitation nobody has used, a person who has signed in (and when), or an account that has never signed in (made some other way, or a link opened without a sign-in). */
export function signInFacts(user: (AuthUserLike & { app_metadata?: Record<string, unknown> | null }) | null | undefined): SignInFacts {
  const meta = (user?.app_metadata ?? {}) as Record<string, unknown>;
  const stamps = [user?.invited_at, meta.invite_emailed_at, meta.invite_link_made_at]
    .filter((x): x is string => typeof x === "string")
    .map((x) => ({ x, ms: Date.parse(x) }))
    .filter((s) => Number.isFinite(s.ms))
    .sort((a, b) => b.ms - a.ms);
  if (isUnaccepted(user)) return { state: "unaccepted", lastSignInAt: null, linkMadeAt: stamps[0]?.x ?? null, signedInRightAfterLink: false };
  if (user?.last_sign_in_at) {
    const at = Date.parse(user.last_sign_in_at);
    const right = Number.isFinite(at) && stamps.some((s) => at >= s.ms && at - s.ms < 10 * 60 * 1000);
    return { state: "signed_in", lastSignInAt: user.last_sign_in_at, linkMadeAt: null, signedInRightAfterLink: right };
  }
  return { state: "never", lastSignInAt: null, linkMadeAt: null, signedInRightAfterLink: false };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Oct 16", or "Oct 16, 2025" when it was not this year (UTC, so the server and the browser agree). */
export function shortDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}${d.getUTCFullYear() === now.getUTCFullYear() ? "" : `, ${d.getUTCFullYear()}`}`;
}

/** The row's state in plain words. */
export function signInWords(f: SignInFacts, now: Date = new Date()): string {
  if (f.state === "unaccepted") return "Invited, not accepted yet";
  if (f.state === "signed_in" && f.lastSignInAt) return `Signed in ${shortDate(f.lastSignInAt, now)}${f.signedInRightAfterLink ? " by an invitation link, right after it was made (a link preview can do that, so they may not have set a password)" : ""}`;
  return "Has never signed in";
}

/** An invitation link older than a day has most likely stopped working (links expire), or was replaced by a newer one. */
export const INVITE_LINK_STALE_MS = 24 * 60 * 60 * 1000;
export function inviteLinkProbablyDead(f: SignInFacts, nowMs: number = Date.now()): boolean {
  if (f.state !== "unaccepted" || !f.linkMadeAt) return false;
  const ms = Date.parse(f.linkMadeAt);
  return Number.isFinite(ms) && nowMs - ms > INVITE_LINK_STALE_MS;
}

/** Sign-in facts for a list of people, read with the server key (a person whose account cannot be read is left out, never guessed). */
export async function loadSignInFacts(serviceRole: any, profileIds: string[]): Promise<Record<string, SignInFacts>> {
  const out: Record<string, SignInFacts> = {};
  await runPool(profileIds, 8, async (id) => {
    try {
      const { data, error } = await serviceRole.auth.admin.getUserById(id);
      if (!error && data?.user) out[id] = signInFacts(data.user);
    } catch {
      // left out
    }
  });
  return out;
}

/** Which of these organization people (members and front desk) have not accepted yet. A person whose account cannot be read, or whose account carries no invitation marker, is left out (never listed on a guess). */
export async function loadPendingInvitees(serviceRole: any, organizationId: string, people: { profileId: string; name: string; role: string }[]): Promise<PendingInvitee[]> {
  const found: PendingInvitee[] = [];
  await runPool(people, 8, async (p) => {
    const { data } = await serviceRole.auth.admin.getUserById(p.profileId);
    const user = data?.user;
    if (!isUnaccepted(user) || !user?.email) return;
    if (organizationId && !(await inviteOnlyFootprint(serviceRole, organizationId, p.profileId)).ok) return;
    found.push({ profileId: p.profileId, name: p.name, email: user.email as string, role: p.role, sentAt: (user.invited_at ?? user.confirmation_sent_at ?? user.created_at ?? null) as string | null });
  });
  return found.sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? ""));
}

/**
 * Which of these people have never signed in: the rule for who may be made OWNER of an organization ("can't transfer ownership until someone is logged in"; the database applies the same one). It is stricter than
 * isUnaccepted on purpose: a confirmed invitation link is not enough, because an email link scanner can open a link with no person acting. A person whose account cannot be read, or is not found, counts as not signed in:
 * for a decision about who may own the organization, an unreadable account is never assumed fine.
 */
export async function notSignedInIds(serviceRole: any, profileIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  await runPool(profileIds, 8, async (id) => {
    try {
      const { data, error } = await serviceRole.auth.admin.getUserById(id);
      if (error || !data?.user || !data.user.last_sign_in_at) out.add(id);
    } catch {
      out.add(id);
    }
  });
  return out;
}

export const RESEND_COOLDOWN_SECONDS = 600;

/** Was a send of this kind made for this account in the last ten minutes? Read from the account itself, written only AFTER a send succeeded, so a failed attempt never locks anybody out. */
export function sentRecently(appMetadata: Record<string, unknown> | null | undefined, field: "invite_emailed_at" | "invite_link_made_at" | "signin_emailed_at", nowMs: number = Date.now()): boolean {
  const at = appMetadata?.[field];
  const ms = typeof at === "string" ? Date.parse(at) : NaN;
  return Number.isFinite(ms) && nowMs - ms < RESEND_COOLDOWN_SECONDS * 1000;
}

export async function markSent(serviceRole: any, userId: string, appMetadata: Record<string, unknown> | null | undefined, field: "invite_emailed_at" | "invite_link_made_at" | "signin_emailed_at", nowMs: number = Date.now()): Promise<void> {
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

/**
 * An account that exists ONLY because this organization invited it: it holds at least one invitation seat in THIS organization (an organization role or a front-desk seat), nothing in any other organization, no
 * client seat anywhere, and only coach seats in this organization's groups. Only such an account may have a sign-in link made for it, be sent again or be cancelled by this organization; anything else (an
 * account another organization invited, or one that is a client somewhere) is out of reach, so one organization can never attach to or sign in as another's invitee. withData also requires that the account has made
 * nothing yet (no health form, no posts, messages or programs), which is what cancelling (deleting the account) needs.
 */
export async function inviteOnlyFootprint(serviceRole: any, organizationId: string, profileId: string, opts: { withData?: boolean } = {}): Promise<{ ok: boolean; reason?: string }> {
  const nowIso = new Date().toISOString();
  const [org, desk, seats, orgInvites, spaceInvites, clientInvites] = await Promise.all([
    serviceRole.from("organization_memberships").select("organization_id").eq("profile_id", profileId),
    serviceRole.from("org_front_desk").select("organization_id").eq("profile_id", profileId),
    serviceRole.from("group_memberships").select("role, groups!inner(organization_id)").eq("profile_id", profileId),
    // Open (unanswered, unexpired) in-app invitations from anybody: if another organization or a space has invited this account, a link made for it could be used to accept that invitation as the account.
    serviceRole.from("organization_invites").select("organization_id").eq("invited_profile_id", profileId).is("answered_at", null).gt("expires_at", nowIso),
    serviceRole.from("space_invites").select("id").eq("invited_profile_id", profileId).is("answered_at", null).gt("expires_at", nowIso),
    serviceRole.from("client_invites").select("id").eq("athlete_id", profileId).is("used_at", null).is("revoked_at", null).gt("expires_at", nowIso),
  ]);
  if (org.error || desk.error || seats.error || orgInvites.error || spaceInvites.error || clientInvites.error) return { ok: false, reason: "unreadable" };
  const orgRows = (org.data ?? []) as { organization_id: string }[];
  const deskRows = (desk.data ?? []) as { organization_id: string }[];
  const seatRows = (seats.data ?? []) as { role: string; groups: { organization_id: string | null } | { organization_id: string | null }[] | null }[];
  if (![...orgRows, ...deskRows].some((r) => r.organization_id === organizationId)) return { ok: false, reason: "not invited by this organization" };
  if ([...orgRows, ...deskRows].some((r) => r.organization_id !== organizationId)) return { ok: false, reason: "belongs to another organization" };
  if (((orgInvites.data ?? []) as { organization_id: string }[]).some((r) => r.organization_id !== organizationId)) return { ok: false, reason: "another organization has invited this account" };
  if (((spaceInvites.data ?? []) as unknown[]).length > 0 || ((clientInvites.data ?? []) as unknown[]).length > 0) return { ok: false, reason: "has an open invitation of another kind" };
  for (const s of seatRows) {
    const g = Array.isArray(s.groups) ? s.groups[0] : s.groups;
    if (s.role !== "coach" || g?.organization_id !== organizationId) return { ok: false, reason: "has a seat that is not one of this invitation's" };
  }
  if (opts.withData) {
    const checks = await Promise.all([
      serviceRole.from("client_intake").select("athlete_id", { count: "exact", head: true }).eq("athlete_id", profileId),
      serviceRole.from("posts").select("id", { count: "exact", head: true }).eq("author_id", profileId),
      serviceRole.from("direct_messages").select("id", { count: "exact", head: true }).eq("sender_id", profileId),
      serviceRole.from("programs").select("id", { count: "exact", head: true }).eq("created_by", profileId),
    ]);
    if (checks.some((c: { error?: unknown }) => c.error)) return { ok: false, reason: "unreadable" };
    if (checks.some((c: { count?: number | null }) => (c.count ?? 0) > 0)) return { ok: false, reason: "has made something" };
  }
  return { ok: true };
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
  // A link is only ever made for an account that exists solely because THIS organization invited it.
  const footprint = await inviteOnlyFootprint(serviceRole, organizationId, profileId);
  if (!footprint.ok) return { ok: false, status: 404, error: "That invitation was not found." };
  const { data: profile } = await serviceRole.from("profiles").select("full_name").eq("id", profileId).maybeSingle();
  return {
    ok: true,
    email: user.email as string,
    name: (profile as { full_name?: string | null } | null)?.full_name ?? "",
    role: member?.role ?? "front_desk",
    appMetadata: ((user.app_metadata ?? {}) as Record<string, unknown>),
  };
}

/**
 * Who a "send sign-in link" may go to: a person of THIS organization (a member that is not the owner, or front desk) with a readable account and an email. An account that is still an unaccepted invitation must also pass the
 * invitation-only footprint (so one organization never reaches another's invitee); an account that has signed in is the person's own and the link only ever goes to their own inbox.
 */
export async function loadSignInTarget(
  serviceRole: any,
  organizationId: string,
  profileId: string
): Promise<{ ok: true; email: string; name: string; role: string; unaccepted: boolean; appMetadata: Record<string, unknown> } | { ok: false; status: number; error: string }> {
  if (!profileId) return { ok: false, status: 400, error: "Missing the person." };
  const [{ data: member }, { data: desk }] = await Promise.all([
    serviceRole.from("organization_memberships").select("role").eq("organization_id", organizationId).eq("profile_id", profileId).maybeSingle(),
    serviceRole.from("org_front_desk").select("profile_id").eq("organization_id", organizationId).eq("profile_id", profileId).maybeSingle(),
  ]);
  if (!member && !desk) return { ok: false, status: 404, error: "That person was not found." };
  if (member?.role === "owner") return { ok: false, status: 409, error: "The owner signs in with their own password. They can use Forgot password." };
  const { data } = await serviceRole.auth.admin.getUserById(profileId);
  const user = data?.user;
  if (!user?.email) return { ok: false, status: 404, error: "That person was not found." };
  const unaccepted = isUnaccepted(user);
  if (unaccepted) {
    const footprint = await inviteOnlyFootprint(serviceRole, organizationId, profileId);
    if (!footprint.ok) return { ok: false, status: 404, error: "That person was not found." };
  }
  const { data: profile } = await serviceRole.from("profiles").select("full_name").eq("id", profileId).maybeSingle();
  return {
    ok: true,
    email: user.email as string,
    name: (profile as { full_name?: string | null } | null)?.full_name ?? "",
    role: member?.role ?? "front_desk",
    unaccepted,
    appMetadata: (user.app_metadata ?? {}) as Record<string, unknown>,
  };
}
