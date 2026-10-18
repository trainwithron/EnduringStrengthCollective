import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail, isEmailConfigured } from "@/lib/email";
import { ageBand, checkGuardianEmail, GUARDIAN_LINK_DAYS } from "@/lib/guardian-consent";

// Server side of the guardian's consent. Everything here uses the server's own (service role) client: the table is not readable from a browser. The link sent to the guardian carries a random token; only its
// SHA-256 is stored, so the stored value cannot be used as a link.
export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");
export const newToken = (): string => randomBytes(32).toString("base64url");

export type RequestResult = { ok: true } | { ok: false; status: number; error: string };

// Who the child's coach is (the first coach of the first group they train in), for the words the guardian reads. Best effort: "their coach" when unknown.
export async function coachNameFor(db: SupabaseClient, athleteId: string): Promise<string | null> {
  const { data: seats } = await db.from("group_memberships").select("group_id").eq("profile_id", athleteId).eq("role", "athlete").order("group_id").limit(5);
  const groupIds = (seats ?? []).map((s: { group_id: string }) => s.group_id);
  if (groupIds.length === 0) return null;
  // The same coach every time (earliest seat, then id), so the words recorded, the words shown and the words emailed always name the same person.
  const { data } = await db.from("group_memberships").select("profiles ( full_name )").in("group_id", groupIds).eq("role", "coach").order("joined_at", { ascending: true }).order("profile_id").limit(1);
  const p = (data as unknown as { profiles: { full_name: string | null } | { full_name: string | null }[] | null }[] | null)?.[0]?.profiles;
  return (Array.isArray(p) ? p[0]?.full_name : p?.full_name) ?? null;
}

// Make a request for this child and email the guardian a one-time link. Earlier waiting requests are replaced (their links stop working). Refused unless the child really is 13 to 17 and the address is a
// different person's inbox. If the email cannot be sent the new request is removed and the old one left as it was.
export async function requestGuardianConsent(db: SupabaseClient, args: { athleteId: string; guardianEmail: string; requestedBy: string; origin: string }): Promise<RequestResult> {
  if (!isEmailConfigured()) return { ok: false, status: 503, error: "Email is not set up yet, so the request could not be sent. Ask your coach to contact support." };

  const [{ data: intake }, { data: profile }, auth] = await Promise.all([
    db.from("client_intake").select("date_of_birth").eq("athlete_id", args.athleteId).maybeSingle(),
    db.from("profiles").select("full_name").eq("id", args.athleteId).maybeSingle(),
    db.auth.admin.getUserById(args.athleteId),
  ]);
  const band = ageBand((intake as { date_of_birth?: string | null } | null)?.date_of_birth);
  if (band === "under13") return { ok: false, status: 400, error: "Spotlight Coaching is for people 13 and older." };
  if (band !== "teen") return { ok: false, status: 400, error: "A guardian's permission is only needed for someone aged 13 to 17." };

  // If the child's own address cannot be read the check against it cannot be made: that is an error, not a pass.
  if (auth.error || !auth.data?.user?.email) return { ok: false, status: 502, error: "Couldn't check that address just now. Try again in a moment." };
  const checked = checkGuardianEmail(args.guardianEmail, auth.data.user.email);
  if (!checked.ok) {
    return { ok: false, status: 400, error: checked.reason === "same_as_child" ? "That is your own email address. Use your parent's or guardian's." : "Enter a real email address." };
  }

  // A guardian's permission that already stands is not replaced by a new request (withdraw it first).
  const { data: standing } = await db.from("guardian_consents").select("id").eq("athlete_id", args.athleteId).eq("status", "signed").limit(1).maybeSingle();
  if (standing) return { ok: false, status: 409, error: "A parent or guardian has already given permission." };

  const token = newToken();
  const { data: row, error: insertError } = await db
    .from("guardian_consents")
    .insert({
      athlete_id: args.athleteId,
      guardian_email: checked.email,
      token_hash: hashToken(token),
      requested_by: args.requestedBy,
      expires_at: new Date(Date.now() + GUARDIAN_LINK_DAYS * 86400000).toISOString(),
    })
    .select("id, created_at")
    .single();
  if (insertError || !row) return { ok: false, status: 502, error: "Couldn't make the request. Try again." };

  const childName = (profile as { full_name?: string | null } | null)?.full_name?.trim() || "your child";
  const coach = await coachNameFor(db, args.athleteId);
  const link = `${args.origin}/guardian-consent/${token}`;
  const sent = await sendEmail(
    checked.email,
    `Permission needed for ${childName} to train`,
    `Hello,

${childName} would like to train${coach ? ` with ${coach}` : ""} using Spotlight Coaching, and because they are under 18 we need a parent or legal guardian to read and agree first.

Please open this link, read what you are agreeing to, and sign if you agree:
${link}

The link works for ${GUARDIAN_LINK_DAYS} days and only for you. You may refuse: if you do not sign, we may decline to coach ${childName}. If you were not expecting this message, ignore it; nothing happens unless you sign.

Spotlight Coaching`
  );
  if (!sent) {
    await db.from("guardian_consents").delete().eq("id", row.id);
    return { ok: false, status: 502, error: "The email could not be sent just now. Try again in a moment." };
  }
  // The request is out: waiting requests OLDER than this one stop working. Only older ones, so two requests made at the same moment (the child's and the coach's) cannot cancel each other: the newest survives.
  const { error: replaceError } = await db.from("guardian_consents").update({ status: "replaced" }).eq("athlete_id", args.athleteId).eq("status", "pending").lt("created_at", row.created_at);
  // If this fails the older link simply stays usable until it expires (either link signs the same child once); say so in the log.
  if (replaceError) console.error("[guardian-consent] could not retire the older request:", replaceError.message);
  return { ok: true };
}
