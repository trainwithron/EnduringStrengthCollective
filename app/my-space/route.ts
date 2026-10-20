import { NextResponse } from "next/server";
import { createCrossOrgServerClient as createServerClient } from "@/lib/supabase/server";
import { ONLY_COACHES_HTML, openOwnSpaceRedirect } from "@/lib/open-own-space";

// The coach's own space: the one set of personal data (programs, history, nutrition, check-ins) that belongs to the person and to no organization. It is made the first time it is asked for.
//   /my-space                -> the coach's own client profile (the same page every client has)
//   /my-space?view=client    -> the coach's own client app ("View as client" for themselves), via the act-as-yourself route
//   &to=calendar|feed|nutrition|settings -> that tab of their own app (the phone bar's tabs from any coach page); &month= and &spot=1 are passed on
// No group needs picking: the space is the person's, whichever organization is open.
export async function GET(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const url = new URL(request.url);
  if (!user) return NextResponse.redirect(new URL("/login", url));

  // Straight into the client app (SPEED, Oct 19: this went through /my-training/open first): lib/open-own-space.ts, shared with /coach-landing so opening the app is one hop.
  if (url.searchParams.get("view") === "client") {
    return (await openOwnSpaceRedirect(user, url, url.searchParams)) ?? NextResponse.redirect(new URL("/dashboard", url));
  }

  const { data: spaceId, error } = await supabase.rpc("ensure_personal_space");
  if (error?.message?.includes("Only coaches")) {
    return new NextResponse(ONLY_COACHES_HTML, { status: 403, headers: { "content-type": "text/html; charset=utf-8" } });
  }
  if (error || !spaceId) return NextResponse.redirect(new URL("/dashboard", url));

  return NextResponse.redirect(new URL(`/groups/${spaceId}/athletes/${user.id}`, url));
}
