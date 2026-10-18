import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

// Runs entirely under the caller's own authenticated session — every
// query below is already scoped to their own id, and RLS backs that up
// regardless, so no service-role client is needed here (unlike the
// deletion route, which has to touch rows it doesn't own).
export async function GET() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

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

  // Everything else the app holds about this person that their own sign-in can read, found by the database itself from every table that points at them
  // (so a table added later is included without anyone remembering to list it). Absent until the database has the function; the list below still downloads then.
  const { data: everything, error: everythingError } = await supabase.rpc("export_my_data");

  const exportData = {
    exportedAt: new Date().toISOString(),
    everything: everythingError ? null : everything,
    everythingNote: everythingError
      ? "The complete collection was not available this time; the sections below are still complete for the main parts of your account. Try again later or contact support."
      : "Every table that holds something about you, keyed table.column. Secrets and sign-in tokens are left out, and so is anything a coach keeps privately about you that your sign-in cannot read.",
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

  return new NextResponse(JSON.stringify(exportData, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": 'attachment; filename="my-data.json"',
    },
  });
}
