import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { advanceDispatch } from "@/lib/trainer-dispatch-advance";

const VALID_GOAL_TYPES = [
  "weight_loss",
  "body_recomp",
  "muscle_gain",
  "bodybuilding",
  "powerbuilding_strongman",
  "endurance_event",
  "custom",
];

// Public, unauthenticated — a prospect has no account at all. A plain
// Next.js route rather than a security-definer RPC (the established
// convention for public writes elsewhere, e.g. book_discovery_call/
// submit_gym_visitor_lead): ranking candidates needs real TS date/
// timezone arithmetic across every trainer's own availability
// (lib/trainer-dispatch-gather.ts), which isn't practical to
// reimplement in plpgsql — a deliberate, noted deviation, not an
// oversight.
export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { organizationId, prospectName, prospectEmail, prospectPhone, prospectTimezone, requestedStartAt, goalType, goalCustomLabel, message } = body;

  if (!organizationId || typeof organizationId !== "string") {
    return NextResponse.json({ error: "Organization is required." }, { status: 400 });
  }
  if (!prospectName || typeof prospectName !== "string" || !prospectName.trim()) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }
  if (!prospectEmail || typeof prospectEmail !== "string" || !prospectEmail.trim()) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }
  if (!prospectTimezone || typeof prospectTimezone !== "string") {
    return NextResponse.json({ error: "Timezone is required." }, { status: 400 });
  }
  if (!requestedStartAt || Number.isNaN(new Date(requestedStartAt).getTime())) {
    return NextResponse.json({ error: "A valid requested time is required." }, { status: 400 });
  }
  if (new Date(requestedStartAt).getTime() <= Date.now()) {
    return NextResponse.json({ error: "Requested time must be in the future." }, { status: 400 });
  }
  if (!VALID_GOAL_TYPES.includes(goalType)) {
    return NextResponse.json({ error: "A valid goal is required." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  const { data: org } = await supabase.from("organizations").select("id").eq("id", organizationId).maybeSingle();
  if (!org) {
    return NextResponse.json({ error: "Organization not found." }, { status: 404 });
  }

  const { data: inserted, error: insertError } = await supabase
    .from("org_trainer_dispatch_requests")
    .insert({
      organization_id: organizationId,
      prospect_name: prospectName.trim(),
      prospect_email: prospectEmail.trim(),
      prospect_phone: prospectPhone?.trim() || null,
      prospect_timezone: prospectTimezone,
      requested_start_at: new Date(requestedStartAt).toISOString(),
      goal_type: goalType,
      goal_custom_label: goalCustomLabel?.trim() || null,
      message: message?.trim() || null,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    return NextResponse.json({ error: "Couldn't submit your request — try again." }, { status: 500 });
  }

  const result = await advanceDispatch(supabase, inserted.id);

  if (result.status === "no_trainer_available") {
    return NextResponse.json({
      requestId: inserted.id,
      matched: false,
      message: "Nobody was immediately available at that time — the gym will reach out to find another time.",
    });
  }

  return NextResponse.json({ requestId: inserted.id, matched: false, dispatched: true });
}
