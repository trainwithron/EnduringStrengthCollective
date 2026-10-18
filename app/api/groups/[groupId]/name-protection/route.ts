import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { loadFeedProtectedIds } from "@/lib/post-name-protection-server";
import { rateLimitResponse } from "@/lib/rate-limit";

// Which of these people must be shown as a first name and last initial, with no photo (anyone under 18, or whose age is not known). A screen that is already open (a new post arriving, a comment thread, the @mention list)
// asks this because it cannot see dates of birth itself. Only a member of the group can ask, and only about people who are members of that group; anyone else in the list (a former member) is protected by default, which
// also means this cannot be used to find out who is an adult elsewhere. The answer is a list of ids; if the lookup fails the answer is "*" (everyone), never the other way round.
const MAX_IDS = 300;

export async function POST(request: Request, context: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await context.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Your session expired. Please sign in again." }, { status: 401 });

  const limited = await rateLimitResponse("name-protection", user.id, 600, 3600);
  if (limited) return limited;

  const { data: seat, error: seatError } = await supabase.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", user.id).maybeSingle();
  if (seatError || !seat) return NextResponse.json({ error: "That group was not found." }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { ids?: unknown };
  const asked = Array.isArray(body.ids) ? Array.from(new Set(body.ids.filter((x): x is string => typeof x === "string" && x.length > 0))) : [];
  if (asked.length === 0) return NextResponse.json({ protectedIds: [] });
  // More than one batch in a single request is never silently cut short: everyone is protected (the browser asks in batches of at most MAX_IDS, so this is only a guard).
  if (asked.length > MAX_IDS) return NextResponse.json({ protectedIds: ["*"] });

  const db = createServiceRoleClient();
  const { data: members, error } = await db.from("group_memberships").select("profile_id").eq("group_id", groupId).in("profile_id", asked);
  if (error) return NextResponse.json({ protectedIds: ["*"] });
  const memberIds = new Set((members ?? []).map((m: { profile_id: string }) => m.profile_id));
  const checked = await loadFeedProtectedIds(Array.from(memberIds));
  if (checked.has("*")) return NextResponse.json({ protectedIds: ["*"] });
  const protectedIds = asked.filter((id) => !memberIds.has(id) || checked.has(id));
  return NextResponse.json({ protectedIds });
}
