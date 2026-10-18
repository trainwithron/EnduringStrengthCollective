import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { collectEverything, deliveryFor, storeAccountExport, type ExportClient } from "@/lib/account-export";

// Every read runs under the caller's own authenticated session — each query is scoped to their own id and row security backs that up regardless. The server key
// is used for exactly one thing: putting a download too large to send directly into a private bucket (lib/account-export.ts) so it can be handed over as a short link.
// The collection can take a while for a person with a lot of data, one small database call per page of each table.
export const maxDuration = 60;

export async function GET(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const limited = await rateLimitResponse("account-export-hour", user.id, 5, 3600);
  if (limited) return limited;

  const userId = user.id;

  const [
    { data: profile },
    { data: profileDetails },
    { data: intake },
    { data: bodyWeightLogs },
    { data: wellnessCheckins },
    { data: athleteSessions },
    { data: workoutLogs },
    { data: habits },
    { data: dailyMacros },
    { data: standingMacroTarget },
    { data: standingMacroHistory },
    { data: posts },
    { data: comments },
    { data: videos },
    { data: videoComments },
    { data: creditPurchases },
    { data: sessionCredits },
    { data: foodPreferences },
    { data: nutritionFeedback },
    { data: uiSettings },
    { data: mealPlanTries },
    { data: readSettings },
  ] = await Promise.all([
    supabase.from("profiles").select("full_name, avatar_url").eq("id", userId).maybeSingle(),
    supabase.from("athlete_profile_details").select("*").eq("athlete_id", userId).maybeSingle(),
    supabase.from("client_intake").select("*").eq("athlete_id", userId).maybeSingle(),
    supabase.from("body_weight_logs").select("*").eq("athlete_id", userId),
    supabase.from("wellness_checkins").select("*").eq("athlete_id", userId),
    supabase.from("athlete_sessions").select("*").eq("athlete_id", userId),
    supabase.from("workout_logs").select("*").eq("athlete_id", userId),
    supabase.from("client_habits").select("id, title, weekdays, habit_logs ( log_date, completed_at )").eq("athlete_id", userId),
    supabase.from("daily_macros").select("*").eq("athlete_id", userId),
    supabase.from("client_macro_targets").select("*").eq("athlete_id", userId).maybeSingle(),
    supabase.from("client_macro_target_history").select("*").eq("athlete_id", userId),
    supabase.from("posts").select("id, body, media_url, channel, created_at").eq("author_id", userId),
    supabase.from("comments").select("id, body, created_at").eq("author_id", userId),
    supabase.from("session_exercise_videos").select("id, session_exercise_id, created_at").eq("athlete_id", userId),
    supabase.from("exercise_video_comments").select("id, body, created_at").eq("author_id", userId),
    supabase.from("credit_purchases").select("credits_purchased, amount_cents, created_at").eq("athlete_id", userId),
    supabase.from("session_credits").select("group_id, balance").eq("athlete_id", userId),
    supabase.from("client_nutrition_preferences").select("*").eq("athlete_id", userId).maybeSingle(),
    supabase.from("client_nutrition_feedback").select("*").eq("athlete_id", userId),
    supabase.from("client_ui_settings").select("hide_demos, updated_at").eq("athlete_id", userId).maybeSingle(),
    supabase.from("meal_plan_tries").select("try_number, note, summary, dates, requested_at, restored_at").eq("athlete_id", userId),
    supabase.from("read_settings").select("faith_track, note_seen_at, updated_at").eq("athlete_id", userId).maybeSingle(),
  ]);

  // Everything else the app holds about this person as a member and client that their own sign-in can read, found by the database itself from every table that names them (so a table added
  // later is included without anyone remembering to list it). Null until the database has the functions; the list below still downloads then.
  const everything = await collectEverything(supabase as unknown as ExportClient);

  const exportData = {
    exportedAt: new Date().toISOString(),
    everything: everything ? everything.tables : null,
    everythingComplete: everything ? everything.complete : false,
    everythingNote: everything
      ? "Everything the app holds about you as a member and client that your sign-in can read, one entry per table and column that names you, newest first. A table that is cut or could not be read says why. Sign-in tokens and other secrets are left out, and so is anything a coach keeps privately about you. A coach's records of their own business are not here: coaches use Export my business."
      : "The complete collection was not available this time; the sections below are still complete for the main parts of your account. Try again later or contact support.",
    profile,
    profileDetails,
    intake,
    bodyWeightLogs,
    wellnessCheckins,
    athleteSessions,
    workoutLogs,
    habits,
    dailyMacros,
    standingMacroTarget,
    standingMacroHistory,
    posts,
    comments,
    videos,
    videoComments,
    creditPurchases,
    sessionCredits,
    foodPreferences,
    nutritionFeedback,
    mealPlanTries,
    uiSettings,
    readSettings,
  };

  const body = JSON.stringify(exportData);
  if (deliveryFor(Buffer.byteLength(body)) === "link") {
    const link = await storeAccountExport(createServiceRoleClient(), userId, body);
    if (!link) return NextResponse.json({ error: "Your download is large and could not be prepared this time. Try again in a few minutes." }, { status: 502 });
    // A browser opening the address gets the file; the button in Settings asks with fetch and is handed the link to open.
    if (request.headers.get("sec-fetch-mode") === "navigate") return NextResponse.redirect(link, 302);
    return NextResponse.json({ downloadUrl: link }, { headers: { "X-Export-Link": "1" } });
  }

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": 'attachment; filename="my-data.json"',
    },
  });
}
