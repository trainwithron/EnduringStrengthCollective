import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createServerClient } from "@/lib/supabase/server";
import { getGoogleCalendarAuthorizeUrl, isGoogleCalendarConfigured } from "@/lib/google-calendar";

// Kicks off the Google Calendar OAuth2 flow. Mirrors app/api/google-
// health/connect/route.ts's shape — plain server-side authorization-
// code flow, same state-cookie CSRF pattern — but coach-only (unlike
// the wearable connections, this is a coach's own work/personal
// calendar split, not an athlete-facing metric source).
export async function GET(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  if (!isGoogleCalendarConfigured()) {
    return NextResponse.json(
      {
        error:
          "Google Calendar isn't configured yet — ask your admin to set GOOGLE_CALENDAR_CLIENT_ID/GOOGLE_CALENDAR_CLIENT_SECRET/GOOGLE_CALENDAR_REDIRECT_URI.",
      },
      { status: 503 }
    );
  }

  const { searchParams } = new URL(request.url);
  const groupId = searchParams.get("groupId");
  if (!groupId) {
    return NextResponse.json({ error: "Missing groupId." }, { status: 400 });
  }

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", groupId)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (membership?.role !== "coach") {
    return NextResponse.json({ error: "Only a coach can connect Google Calendar." }, { status: 403 });
  }

  const nonce = randomBytes(16).toString("hex");
  const state = `${nonce}.${groupId}`;

  const response = NextResponse.redirect(getGoogleCalendarAuthorizeUrl(state));
  response.cookies.set("google_calendar_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return response;
}
