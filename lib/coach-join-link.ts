import { createHmac, timingSafeEqual } from "node:crypto";

// ONE invitation link per invited person (Release TC3). The link is /join-coach/<id>.<signature>. The signature is made from the row's id and a server secret, so the table stores no link and no secret: the same link can be
// shown again whenever an administrator copies it, the email carries exactly that link, and a copy of the table alone gives nobody a working link. Opening the link changes nothing; the link is used up only by the POST of a
// password on its page (app/api/coaches/join). Server only.
export const JOIN_LINK_DAYS = 14;
const DAY_MS = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function secret(): string {
  const s = process.env.JOIN_LINK_SECRET || process.env.SHARE_LINK_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!s) throw new Error("No secret is configured for join links.");
  return s;
}
const mac = (id: string) => createHmac("sha256", secret()).update(`coach-join-link:v1:${id.toLowerCase()}`).digest("base64url");

export function joinLinkToken(id: string): string {
  return `${id.toLowerCase()}.${mac(id)}`;
}

/** The row id inside a link's token, when the signature is right; otherwise null. Nothing about a wrong token says why. */
export function parseJoinLinkToken(token: unknown): string | null {
  if (typeof token !== "string" || token.length > 200) return null;
  const dot = token.indexOf(".");
  if (dot !== 36) return null;
  const id = token.slice(0, dot);
  if (!UUID.test(id)) return null;
  try {
    const expected = Buffer.from(mac(id));
    const given = Buffer.from(token.slice(dot + 1));
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  } catch {
    return null;
  }
  return id.toLowerCase();
}

export const joinLinkUrl = (origin: string, id: string) => `${origin.replace(/\/+$/, "")}/join-coach/${joinLinkToken(id)}`;

export interface JoinLinkRow {
  id: string;
  organization_id: string;
  profile_id: string;
  kind: "invite" | "signin";
  created_by: string | null;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
}
export const JOIN_LINK_COLUMNS = "id, organization_id, profile_id, kind, created_by, created_at, expires_at, used_at, revoked_at";

export type JoinLinkState = "open" | "expired" | "used" | "revoked";
export function joinLinkState(row: Pick<JoinLinkRow, "expires_at" | "used_at" | "revoked_at">, now: Date = new Date()): JoinLinkState {
  if (row.used_at) return "used";
  if (row.revoked_at) return "revoked";
  return Date.parse(row.expires_at) <= now.getTime() ? "expired" : "open";
}

const newEnd = (now: Date) => new Date(now.getTime() + JOIN_LINK_DAYS * DAY_MS).toISOString();

/**
 * The person's one open link, made if there is none. Sending it again (extend) or finding it ended moves its end date out and keeps the SAME link; only a link of the other kind is cancelled and replaced (an invitation an
 * administrator may have copied can never become a sign-in link for an account that has signed in). Never throws: false when the table cannot be read or written.
 */
export async function ensureJoinLink(
  db: any,
  args: { organizationId: string; profileId: string; kind: "invite" | "signin"; createdBy: string | null; extend: boolean; now?: Date }
): Promise<{ ok: true; row: JoinLinkRow; created: boolean } | { ok: false }> {
  const now = args.now ?? new Date();
  try {
    const find = async (): Promise<JoinLinkRow | null> => {
      const { data, error } = await db
        .from("coach_join_links")
        .select(JOIN_LINK_COLUMNS)
        .eq("organization_id", args.organizationId)
        .eq("profile_id", args.profileId)
        .is("used_at", null)
        .is("revoked_at", null)
        .maybeSingle();
      if (error) throw new Error("read");
      return (data as JoinLinkRow | null) ?? null;
    };
    let row = await find();
    if (row && row.kind !== args.kind) {
      const { error } = await db.from("coach_join_links").update({ revoked_at: now.toISOString() }).eq("id", row.id).is("used_at", null).is("revoked_at", null);
      if (error) return { ok: false };
      row = null;
    }
    if (row) {
      if (args.extend || joinLinkState(row, now) === "expired") {
        const expires = newEnd(now);
        const { error } = await db.from("coach_join_links").update({ expires_at: expires }).eq("id", row.id).is("used_at", null).is("revoked_at", null);
        if (error) return { ok: false };
        row = { ...row, expires_at: expires };
      }
      return { ok: true, row, created: false };
    }
    const { data, error } = await db
      .from("coach_join_links")
      .insert({ organization_id: args.organizationId, profile_id: args.profileId, kind: args.kind, created_by: args.createdBy, expires_at: newEnd(now) })
      .select(JOIN_LINK_COLUMNS)
      .single();
    if (error || !data) {
      // two presses at once: the other one made it
      if ((error as { code?: string } | null)?.code === "23505") {
        const again = await find();
        if (again) return { ok: true, row: again, created: false };
      }
      return { ok: false };
    }
    return { ok: true, row: data as JoinLinkRow, created: true };
  } catch {
    return { ok: false };
  }
}
