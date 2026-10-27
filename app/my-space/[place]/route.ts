import { NextResponse } from "next/server";
import { createCrossOrgServerClient as createServerClient } from "@/lib/supabase/server";
import { openOwnSpaceRedirect } from "@/lib/open-own-space";
import { isMySpacePlace, placeParams } from "@/lib/my-space-target";

// One place in the coach's own app, by its own address (lib/my-space-target.ts says why each place needs its own path):
//   /my-space/home, /my-space/spotlight, /my-space/calendar, /my-space/feed, /my-space/nutrition, /my-space/settings; ?month=YYYY-MM is passed on.
// The same one redirect as /my-space?view=client&to=<tab> (which keeps working for old links).
export async function GET(request: Request, props: { params: Promise<{ place: string }> }) {
  const { place } = await props.params;
  const url = new URL(request.url);
  if (!isMySpacePlace(place)) return NextResponse.redirect(new URL("/my-space/home", url));
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", url));
  return (await openOwnSpaceRedirect(user, url, placeParams(place, url.searchParams))) ?? NextResponse.redirect(new URL("/dashboard", url));
}
