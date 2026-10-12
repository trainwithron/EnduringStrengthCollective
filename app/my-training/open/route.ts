import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { ACTING_AS_COOKIE, ACTING_AS_SELF_COOKIE } from "@/lib/acting-as";
import { VIEW_OVERRIDE_COOKIE } from "@/lib/pwa";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Opens "My training" in one group: the person's own client app (Home, today's workout, Calendar, Nutrition, History), the same one a client gets. For a coach this is the existing "act as
// yourself" setting made automatic, so nothing about who is signed in or whose data is read changes: every page still reads and writes as the signed-in person under the usual row security.
// The group must be one the person belongs to. The phone-style layout is switched on too, so it also works at a desktop; "Back to coaching" turns both off again.
export async function GET(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const url = new URL(request.url);
  if (!user) return NextResponse.redirect(new URL("/login", url));

  const groupId = url.searchParams.get("group") ?? "";
  if (!UUID.test(groupId)) return NextResponse.redirect(new URL("/my-training", url));
  const { data: membership } = await supabase.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", user.id).maybeSingle();
  if (!membership) return NextResponse.redirect(new URL("/my-training", url));

  const response = NextResponse.redirect(new URL(`/groups/${groupId}`, url));
  const secure = process.env.NODE_ENV === "production";
  // Only a COACH needs the act-as setting (a client already sees the client app as themselves).
  if (membership.role === "coach") {
    response.cookies.set(ACTING_AS_COOKIE, JSON.stringify({ athleteId: user.id, groupId }), { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 60 * 60 * 12 });
    response.cookies.set(ACTING_AS_SELF_COOKIE, "1", { httpOnly: false, sameSite: "lax", secure, path: "/", maxAge: 60 * 60 * 12 });
    response.cookies.set(VIEW_OVERRIDE_COOKIE, "mobile", { httpOnly: false, sameSite: "lax", secure, path: "/", maxAge: 60 * 60 * 24 * 365 });
  }
  return response;
}
