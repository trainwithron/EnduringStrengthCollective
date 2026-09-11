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
    { data: posts },
    { data: comments },
    { data: videos },
    { data: videoComments },
    { data: creditPurchases },
    { data: sessionCredits },
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
    supabase.from("posts").select("id, body, media_url, channel, created_at").eq("author_id", userId),
    supabase.from("comments").select("id, body, created_at").eq("author_id", userId),
    supabase.from("session_exercise_videos").select("id, session_exercise_id, created_at").eq("athlete_id", userId),
    supabase.from("exercise_video_comments").select("id, body, created_at").eq("author_id", userId),
    supabase.from("credit_purchases").select("credits_purchased, amount_cents, created_at").eq("athlete_id", userId),
    supabase.from("session_credits").select("group_id, balance").eq("athlete_id", userId),
  ]);

  const exportData = {
    exportedAt: new Date().toISOString(),
    profile,
    profileDetails,
    intake,
    bodyWeightLogs,
    wellnessCheckins,
    athleteSessions,
    workoutLogs,
    habits,
    dailyMacros,
    posts,
    comments,
    videos,
    videoComments,
    creditPurchases,
    sessionCredits,
  };

  return new NextResponse(JSON.stringify(exportData, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": 'attachment; filename="my-data.json"',
    },
  });
}
