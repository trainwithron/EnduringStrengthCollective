import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { acceptDispatchStep } from "@/lib/trainer-dispatch-advance";

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { stepId } = await request.json();
  if (!stepId) return NextResponse.json({ error: "stepId is required." }, { status: 400 });

  const { data: step } = await supabase
    .from("org_trainer_dispatch_steps")
    .select("trainer_id")
    .eq("id", stepId)
    .maybeSingle();
  if (!step || step.trainer_id !== user.id) {
    return NextResponse.json({ error: "Not your request." }, { status: 403 });
  }

  const serviceRole = createServiceRoleClient();
  const result = await acceptDispatchStep(serviceRole, stepId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
