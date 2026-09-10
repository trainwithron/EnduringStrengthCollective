import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createServerClient } from "@/lib/supabase/server";
import { getOuraAuthorizeUrl, isOuraConfigured } from "@/lib/oura";

// Kicks off the Oura OAuth2 flow. Linked to directly from the settings
// page (a plain <a href>, not a fetch call) so the browser follows the
// redirect straight to Oura's consent screen.
export async function GET(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  if (!isOuraConfigured()) {
    return NextResponse.json(
      {
        error:
          "Oura isn't configured yet — ask your admin to set OURA_CLIENT_ID/OURA_CLIENT_SECRET/OURA_REDIRECT_URI.",
      },
      { status: 503 }
    );
  }

  const { searchParams } = new URL(request.url);
  const groupId = searchParams.get("groupId");
  if (!groupId) {
    return NextResponse.json({ error: "Missing groupId." }, { status: 400 });
  }

  // The state param round-trips through Oura's consent screen and comes
  // back on the callback — used both as a CSRF check (must match the
  // cookie set here) and to carry the groupId back so we know which
  // settings page to redirect to afterward.
  const nonce = randomBytes(16).toString("hex");
  const state = `${nonce}.${groupId}`;

  const response = NextResponse.redirect(getOuraAuthorizeUrl(state));
  response.cookies.set("oura_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return response;
}
