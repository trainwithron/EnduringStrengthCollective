import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  createWorkCalendar,
  exchangeGoogleCalendarCode,
  fetchGoogleAccountEmail,
  shareCalendarFreeBusy,
} from "@/lib/google-calendar";

// Mirrors app/api/google-health/callback/route.ts's shape (state-cookie
// CSRF check, try/catch redirect-with-error). What's different here:
// on a brand-new connection, this also does the real one-time setup
// work from google_calendar_federation_feasibility_sept16.md's
// architecture (a) — create the dedicated work calendar, then share it
// back to the coach's own Google account at freeBusyReader — before the
// connection is considered "active." A reconnect (existing
// work_calendar_id already on file) skips straight to re-sharing, so a
// coach who revokes and re-grants access doesn't end up with two work
// calendars.
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
  const storedState = cookieStore.get("google_calendar_oauth_state")?.value;
  const groupId = storedState?.split(".")[1];
  const settingsUrl = groupId
    ? new URL(`/groups/${groupId}/settings`, request.url)
    : new URL("/", request.url);

  if (oauthError) {
    settingsUrl.searchParams.set("google_calendar_error", "Google Calendar connection was cancelled.");
    return NextResponse.redirect(settingsUrl);
  }

  if (!code || !returnedState || !storedState || returnedState !== storedState) {
    settingsUrl.searchParams.set("google_calendar_error", "Google Calendar connection failed — please try again.");
    return NextResponse.redirect(settingsUrl);
  }

  try {
    const tokens = await exchangeGoogleCalendarCode(code);
    const personalEmail = await fetchGoogleAccountEmail(tokens.accessToken);
    const serviceRole = createServiceRoleClient();

    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .maybeSingle();
    const coachName = profile?.full_name ?? "Coach";

    const { data: existingConnection } = await serviceRole
      .from("google_calendar_connections")
      .select("id, work_calendar_id")
      .eq("coach_id", user.id)
      .maybeSingle();

    const workCalendarId =
      existingConnection?.work_calendar_id ?? (await createWorkCalendar(tokens.accessToken, coachName));
    await shareCalendarFreeBusy(tokens.accessToken, workCalendarId, personalEmail);

    const { data: connection, error: connectionError } = await serviceRole
      .from("google_calendar_connections")
      .upsert(
        {
          coach_id: user.id,
          work_calendar_id: workCalendarId,
          personal_email: personalEmail,
          status: "active",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "coach_id" }
      )
      .select("id")
      .single();
    if (connectionError || !connection) throw connectionError ?? new Error("Couldn't save connection.");

    const { error: tokenError } = await serviceRole.from("google_calendar_oauth_tokens").upsert(
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
    response.cookies.delete("google_calendar_oauth_state");
    return response;
  } catch (err) {
    console.error("Google Calendar OAuth callback failed:", err);
    settingsUrl.searchParams.set("google_calendar_error", "Couldn't connect Google Calendar — please try again.");
    return NextResponse.redirect(settingsUrl);
  }
}
