import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

// AI Assistant Phase 2 — enforces the resolved 90-day retention window for
// Collective Intelligence chat transcripts
// (collective_intelligence_phase_2_conversational_assistant.md). RLS scopes
// who can SEE a thread, but doesn't expire anything on its own — this daily
// cron is the real enforcement of "auto-delete after 90 days," same
// CRON_SECRET/service-role shape as every other cron in this app.
const RETENTION_DAYS = 90;

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET isn't configured." }, { status: 503 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

  // Deleting the thread cascades to its messages (on delete cascade) — one
  // statement, not a two-step message-then-thread delete.
  const { data: expiredThreads } = await supabase
    .from("coach_chat_threads")
    .select("id")
    .lt("last_message_at", cutoff.toISOString());

  const expiredIds = (expiredThreads ?? []).map((t) => t.id);
  if (expiredIds.length > 0) {
    await supabase.from("coach_chat_threads").delete().in("id", expiredIds);
  }

  return NextResponse.json({ deletedThreads: expiredIds.length });
}
