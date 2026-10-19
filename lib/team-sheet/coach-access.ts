import { NextResponse } from "next/server";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status, headers: { "Cache-Control": "no-store" } });

/** Signed in, and a coach of this group (checked as the caller, so row security decides). A failed check is an error, never a permission. */
export async function requireCoach(supabase: any, groupId: string): Promise<{ ok: true; userId: string } | { ok: false; response: NextResponse }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, response: fail(401, "Not signed in.") };
  if (!UUID.test(groupId)) return { ok: false, response: fail(400, "Choose a group.") };
  const { data: membership, error } = await supabase.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", user.id).maybeSingle();
  if (error) return { ok: false, response: fail(502, "Couldn't check your access. Try again.") };
  if (membership?.role !== "coach") return { ok: false, response: fail(403, "Only a coach of this group can do that.") };
  return { ok: true, userId: user.id };
}
