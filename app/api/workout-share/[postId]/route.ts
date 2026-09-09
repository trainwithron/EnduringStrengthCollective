import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getSharedWorkout } from "@/lib/shared-workout";

function randomCode(length = 10) {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

// Powers the in-feed "expand" on a workout card — same data the public
// /share/[postId] page shows, just fetched on demand instead of always
// paying for it in the feed's initial load. Authenticated + a normal
// group-member RLS read (not the anon path /share uses), so this only
// ever returns something for someone who could already see the post.
export async function GET(request: Request, props: { params: Promise<{ postId: string }> }) {
  const params = await props.params;
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const shared = await getSharedWorkout(params.postId);
  if (!shared) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Lazily create one persistent, never-expiring join code for this
  // group (separate from the short-lived per-invite codes a coach
  // generates one at a time) so the shareable image can print a real,
  // reusable "join this team" link as plain text — only coaches can
  // normally write group_invites, so this one write goes through the
  // service-role client instead.
  const { data: group } = await supabase
    .from("groups")
    .select("public_invite_code")
    .eq("id", shared.groupId)
    .maybeSingle();

  let joinCode = group?.public_invite_code ?? null;
  if (!joinCode) {
    const serviceRole = createServiceRoleClient();
    const { data: coachMembership } = await serviceRole
      .from("group_memberships")
      .select("profile_id")
      .eq("group_id", shared.groupId)
      .eq("role", "coach")
      .limit(1)
      .maybeSingle();

    if (coachMembership) {
      const code = randomCode();
      const { error: inviteError } = await serviceRole.from("group_invites").insert({
        group_id: shared.groupId,
        code,
        role: "athlete",
        created_by: coachMembership.profile_id,
        expires_at: null,
      });
      if (!inviteError) {
        await serviceRole.from("groups").update({ public_invite_code: code }).eq("id", shared.groupId);
        joinCode = code;
      }
    }
  }

  const origin = request.headers.get("origin") ?? new URL(request.url).origin;
  const joinUrl = joinCode ? `${origin}/invite/${joinCode}` : null;

  return NextResponse.json({ ...shared, joinUrl });
}
