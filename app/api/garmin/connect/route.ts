import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createServerClient } from "@/lib/supabase/server";
import { getGarminAuthorizeUrl, generateGarminPkcePair, isGarminConfigured } from "@/lib/garmin";

// Kicks off the Garmin OAuth2 PKCE flow. Mirrors app/api/oura/connect/
// route.ts's shape (auth check, groupId param, state cookie), with one
// real addition: Garmin requires PKCE, so a code_verifier is generated
// here and stashed in its own short-lived cookie alongside the existing
// CSRF state cookie — the callback route needs both to complete the
// token exchange.
export async function GET(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  if (!isGarminConfigured()) {
    return NextResponse.json(
      {
        error:
          "Garmin isn't configured yet — ask your admin to set GARMIN_CLIENT_ID/GARMIN_CLIENT_SECRET/GARMIN_REDIRECT_URI.",
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
  const { codeVerifier, codeChallenge } = generateGarminPkcePair();

  const response = NextResponse.redirect(getGarminAuthorizeUrl(state, codeChallenge));
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 600,
    path: "/",
  };
  response.cookies.set("garmin_oauth_state", state, cookieOptions);
  response.cookies.set("garmin_oauth_verifier", codeVerifier, cookieOptions);
  return response;
}
