import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createServerClient } from "@/lib/supabase/server";
import { getWithingsAuthorizeUrl, isWithingsConfigured } from "@/lib/withings";

// Kicks off the Withings OAuth2 flow. Linked to directly from the
// settings page (a plain <a href>, not a fetch call) so the browser
// follows the redirect straight to Withings' consent screen. Mirrors
// app/api/oura/connect/route.ts exactly.
export async function GET(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  if (!isWithingsConfigured()) {
    return NextResponse.json(
      {
        error:
          "Withings isn't configured yet — ask your admin to set WITHINGS_CLIENT_ID/WITHINGS_CLIENT_SECRET/WITHINGS_REDIRECT_URI.",
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

  const response = NextResponse.redirect(getWithingsAuthorizeUrl(state));
  response.cookies.set("withings_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return response;
}
