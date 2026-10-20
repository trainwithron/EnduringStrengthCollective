import { NextResponse } from "next/server";
import { createCrossOrgServerClient } from "@/lib/supabase/server";
import { setMyTrainingCookies } from "@/lib/my-training-cookies";
import { mySpaceTarget } from "@/lib/my-space-target";

// Straight into the coach's own client app (their personal space), as one redirect: the space is made if it isn't there yet, the seat is checked, and the act-as-yourself cookies are
// set on the same response. Used by /my-space?view=client and by /coach-landing when that is where the coach lands (phone speed B7: opening the app was four hops, now this one).
// Null only when something unexpected was thrown (the caller then falls back to the old way, the /my-space hop).
export const ONLY_COACHES_HTML =
  "<!doctype html><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><body style=\"font-family:system-ui;padding:2rem;max-width:32rem\"><p>Only coaches have a personal space.</p><p><a href=\"/\">Back</a></p></body>";

export async function openOwnSpaceRedirect(user: { id: string }, url: URL, params: URLSearchParams): Promise<NextResponse | null> {
  try {
    // Never filtered to the open organization: the personal space belongs to no organization.
    const supabase = await createCrossOrgServerClient();
    const { data: spaceId, error } = await supabase.rpc("ensure_personal_space");
    if (error?.message?.includes("Only coaches")) {
      return new NextResponse(ONLY_COACHES_HTML, { status: 403, headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (error || !spaceId) return NextResponse.redirect(new URL("/dashboard", url));
    // The same seat check and the same cookies /my-training/open sets.
    const { data: seat } = await supabase.from("group_memberships").select("role").eq("group_id", spaceId).eq("profile_id", user.id).maybeSingle();
    if (!seat) return NextResponse.redirect(new URL("/my-training", url));
    const response = NextResponse.redirect(new URL(mySpaceTarget(spaceId as string, params), url));
    setMyTrainingCookies(response, { userId: user.id, groupId: spaceId as string, role: (seat as { role: string }).role });
    return response;
  } catch {
    return null;
  }
}
