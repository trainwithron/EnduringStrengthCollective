import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { getAiUsage } from "@/lib/coach-credits";

// Feeds the coach-facing usage meter: how much of this month's included
// AI generations (per 100-client step) a coach has used. Read-only, and
// always the signed-in coach's own numbers.
export async function GET() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  return NextResponse.json(await getAiUsage(supabase, user.id));
}
