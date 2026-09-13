import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { exchangeWithingsCode } from "@/lib/withings";

// Withings redirects back here after the user approves (or denies)
// access. Mirrors app/api/oura/callback/route.ts exactly, including the
// "never put the real error text in a redirect URL" rule.
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
  const storedState = cookieStore.get("withings_oauth_state")?.value;
  const groupId = storedState?.split(".")[1];
  const settingsUrl = groupId
    ? new URL(`/groups/${groupId}/settings`, request.url)
    : new URL("/", request.url);

  if (oauthError) {
    settingsUrl.searchParams.set("withings_error", "Withings connection was cancelled.");
    return NextResponse.redirect(settingsUrl);
  }

  if (!code || !returnedState || !storedState || returnedState !== storedState) {
    settingsUrl.searchParams.set("withings_error", "Withings connection failed — please try again.");
    return NextResponse.redirect(settingsUrl);
  }

  try {
    const tokens = await exchangeWithingsCode(code);
    const serviceRole = createServiceRoleClient();

    const { data: connection, error: connectionError } = await serviceRole
      .from("wearable_connections")
      .upsert(
        {
          profile_id: user.id,
          provider: "withings",
          connected_at: new Date().toISOString(),
          status: "active",
        },
        { onConflict: "profile_id,provider" }
      )
      .select("id")
      .single();
    if (connectionError || !connection) throw connectionError ?? new Error("Couldn't save connection.");

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
    response.cookies.delete("withings_oauth_state");
    return response;
  } catch (err) {
    console.error("Withings OAuth callback failed:", err);
    settingsUrl.searchParams.set("withings_error", "Couldn't connect Withings — please try again.");
    return NextResponse.redirect(settingsUrl);
  }
}
