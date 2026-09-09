import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { exchangeOuraCode } from "@/lib/oura";

// Oura redirects back here after the user approves (or denies) access.
// The session cookie set by /api/oura/connect's redirect is still the
// same browser tab, so the user's own auth session is still valid here —
// no need to smuggle their identity through the state param.
export async function GET(request: Request) {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const returnedState = searchParams.get("state");
  const oauthError = searchParams.get("error");

  const cookieStore = await cookies();
  const storedState = cookieStore.get("oura_oauth_state")?.value;
  const groupId = storedState?.split(".")[1];
  const settingsUrl = groupId
    ? new URL(`/groups/${groupId}/settings`, request.url)
    : new URL("/", request.url);

  if (oauthError) {
    settingsUrl.searchParams.set("oura_error", "Oura connection was cancelled.");
    return NextResponse.redirect(settingsUrl);
  }

  if (!code || !returnedState || !storedState || returnedState !== storedState) {
    settingsUrl.searchParams.set("oura_error", "Oura connection failed — please try again.");
    return NextResponse.redirect(settingsUrl);
  }

  try {
    const tokens = await exchangeOuraCode(code);
    const serviceRole = createServiceRoleClient();

    const { data: connection, error: connectionError } = await serviceRole
      .from("wearable_connections")
      .upsert(
        {
          profile_id: user.id,
          provider: "oura",
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
    response.cookies.delete("oura_oauth_state");
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    settingsUrl.searchParams.set("oura_error", `Couldn't connect Oura: ${message}`);
    return NextResponse.redirect(settingsUrl);
  }
}
