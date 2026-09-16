import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createServerClient } from "@/lib/supabase/server";
import { getGoogleHealthAuthorizeUrl, isGoogleHealthConfigured } from "@/lib/google-health";

// Kicks off the Google Health OAuth2 flow. Mirrors app/api/oura/connect/
// route.ts's shape exactly — plain server-side authorization-code flow,
// no PKCE (unlike Garmin), same state-cookie CSRF pattern.
export async function GET(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  if (!isGoogleHealthConfigured()) {
    return NextResponse.json(
      {
        error:
          "Google Health isn't configured yet — ask your admin to set GOOGLE_HEALTH_CLIENT_ID/GOOGLE_HEALTH_CLIENT_SECRET/GOOGLE_HEALTH_REDIRECT_URI.",
      },
      { status: 503 }
    );
  }

  const { searchParams } = new URL(request.url);
  const groupId = searchParams.get("groupId");
  if (!groupId) {
    return NextResponse.json({ error: "Missing groupId." }, { status: 400 });
  }

  const nonce = randomBytes(16).toString("hex");
  const state = `${nonce}.${groupId}`;

  const response = NextResponse.redirect(getGoogleHealthAuthorizeUrl(state));
  response.cookies.set("google_health_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return response;
}
