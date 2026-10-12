import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { getCoachedGroups, LAST_WORKSPACE_GROUP_COOKIE, pickAnchorGroup } from "@/lib/coach-groups";

// Choosing an organization: the organization must be one the signed-in coach is a coach in (anything else goes back to the chooser). The workspace is remembered as that organization's usual team or
// social group, and every coach page follows it.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", url));

  const orgId = url.searchParams.get("org") ?? "";
  const rawNext = url.searchParams.get("next") ?? "/dashboard";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/dashboard";

  const groups = await getCoachedGroups(supabase, user.id);
  const inOrg = groups.filter((g) => g.orgId === orgId);
  const anchor = pickAnchorGroup(inOrg, null, orgId);
  if (!anchor) return NextResponse.redirect(new URL("/choose-organization", url));

  const response = NextResponse.redirect(new URL(next, url));
  response.cookies.set(LAST_WORKSPACE_GROUP_COOKIE, encodeURIComponent(anchor.id), {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 90,
  });
  return response;
}
