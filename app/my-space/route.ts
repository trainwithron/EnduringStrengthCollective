import { NextResponse } from "next/server";
import { createCrossOrgServerClient as createServerClient } from "@/lib/supabase/server";

// The coach's own space: the one set of personal data (programs, history, nutrition, check-ins) that belongs to the person and to no organization. It is made the first time it is asked for.
//   /my-space                -> the coach's own client profile (the same page every client has)
//   /my-space?view=client    -> the coach's own client app ("View as client" for themselves), via the act-as-yourself route
// No group needs picking: the space is the person's, whichever organization is open.
export async function GET(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const url = new URL(request.url);
  if (!user) return NextResponse.redirect(new URL("/login", url));

  const { data: spaceId, error } = await supabase.rpc("ensure_personal_space");
  if (error?.message?.includes("Only coaches")) {
    return new NextResponse("<!doctype html><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><body style=\"font-family:system-ui;padding:2rem;max-width:32rem\"><p>Only coaches have a personal space.</p><p><a href=\"/\">Back</a></p></body>", { status: 403, headers: { "content-type": "text/html; charset=utf-8" } });
  }
  if (error || !spaceId) return NextResponse.redirect(new URL("/dashboard", url));

  if (url.searchParams.get("view") === "client") {
    return NextResponse.redirect(new URL(`/my-training/open?group=${spaceId}`, url));
  }
  return NextResponse.redirect(new URL(`/groups/${spaceId}/athletes/${user.id}`, url));
}
