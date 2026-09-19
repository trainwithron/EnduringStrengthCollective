import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { askDispatchQuestion } from "@/lib/trainer-dispatch-advance";

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { stepId, question } = await request.json();
  if (!stepId || !question || typeof question !== "string" || !question.trim()) {
    return NextResponse.json({ error: "A question is required." }, { status: 400 });
  }

  const { data: step } = await supabase
    .from("org_trainer_dispatch_steps")
    .select("trainer_id")
    .eq("id", stepId)
    .maybeSingle();
  if (!step || step.trainer_id !== user.id) {
    return NextResponse.json({ error: "Not your request." }, { status: 403 });
  }

  const origin = request.headers.get("origin") ?? new URL(request.url).origin;
  const serviceRole = createServiceRoleClient();
  const result = await askDispatchQuestion(serviceRole, stepId, question.trim(), origin);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
