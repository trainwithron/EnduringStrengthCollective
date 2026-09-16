import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { exchangeGarminCode } from "@/lib/garmin";

// Garmin redirects back here after the user approves (or denies) access.
// Mirrors app/api/oura/callback/route.ts's shape (state/CSRF check,
// upsert connection + tokens, redirect to Settings with a clear error
// param on failure). Two real differences from Oura's callback:
//
// 1. PKCE — the code_verifier stashed in its own cookie by /connect is
//    required at token-exchange time, not just the state value.
// 2. No historical backfill call here, unlike Oura/Withings. Garmin's
//    Health API is push-based (see lib/garmin.ts's header comment) —
//    there is no confirmed REST endpoint to pull past data on demand,
//    only the webhook this app registers to receive going forward
//    (app/api/garmin/webhook/route.ts). A brand-new connection starts
//    from whatever Garmin's first push delivers, same as any other
//    push-based integration; there's nothing to backfill against
//    without an unverified REST endpoint this app has no partner access
//    to confirm.
export async function GET(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const returnedState = searchParams.get("state");
  const oauthError = searchParams.get("error");

  const cookieStore = await cookies();
  const storedState = cookieStore.get("garmin_oauth_state")?.value;
  const codeVerifier = cookieStore.get("garmin_oauth_verifier")?.value;
  const groupId = storedState?.split(".")[1];
  const settingsUrl = groupId
    ? new URL(`/groups/${groupId}/settings`, request.url)
    : new URL("/", request.url);

  if (oauthError) {
    settingsUrl.searchParams.set("garmin_error", "Garmin connection was cancelled.");
    return NextResponse.redirect(settingsUrl);
  }

  if (!code || !returnedState || !storedState || returnedState !== storedState || !codeVerifier) {
    settingsUrl.searchParams.set("garmin_error", "Garmin connection failed — please try again.");
    return NextResponse.redirect(settingsUrl);
  }

  try {
    const tokens = await exchangeGarminCode(code, codeVerifier);
    const serviceRole = createServiceRoleClient();

    const { data: connection, error: connectionError } = await serviceRole
      .from("wearable_connections")
      .upsert(
        {
          profile_id: user.id,
          provider: "garmin",
          connected_at: new Date().toISOString(),
          status: "active",
        },
        { onConflict: "profile_id,provider" }
      )
      .select("id")
      .single();
    if (connectionError || !connection) throw connectionError ?? new Error("Couldn't save connection.");

    // No separate "get Garmin user ID" call — Garmin's push webhooks
    // identify the user by the OAuth access token itself (the "User
    // Access Token"), not a numeric ID exposed to partners, per Garmin's
    // documented privacy-preserving design. wearable_connections.
    // external_user_id stays null for Garmin; app/api/garmin/webhook/
    // route.ts resolves a push back to a connection by matching the
    // access token stored below instead. Re-verify this assumption
    // directly once real partner API access exists (see lib/garmin.ts's
    // header comment).
    const { error: tokenError } = await serviceRole.from("wearable_oauth_tokens").upsert(
      {
        connection_id: connection.id,
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expires_at: tokens.expiresAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "connection_id" }
    );
    if (tokenError) throw tokenError;

    const response = NextResponse.redirect(settingsUrl);
    response.cookies.delete("garmin_oauth_state");
    response.cookies.delete("garmin_oauth_verifier");
    return response;
  } catch (err) {
    console.error("Garmin OAuth callback failed:", err);
    settingsUrl.searchParams.set("garmin_error", "Couldn't connect Garmin — please try again.");
    return NextResponse.redirect(settingsUrl);
  }
}
