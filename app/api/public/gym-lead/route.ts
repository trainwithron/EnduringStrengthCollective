import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { clientIp, rateLimitAllows } from "@/lib/rate-limit";
import { validateGymLead } from "@/lib/public-forms";

// A visitor at a gym leaves their contact details after scanning an equipment QR code (no account). Every lead notifies the gym's
// owners and admins, so this is limited per address and per gym, and the text is checked before it reaches the database function.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const checked = validateGymLead(body);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
  const v = checked.value;

  if (!(await rateLimitAllows(`gym-lead-ip:${clientIp(request)}`, 6, 3600))) {
    return NextResponse.json({ error: "Too many requests. Please try again in a little while." }, { status: 429 });
  }
  if (!(await rateLimitAllows(`gym-lead-org:${v.organizationId}`, 60, 3600))) {
    return NextResponse.json({ error: "This page is busy right now. Please try again in a little while." }, { status: 429 });
  }

  const db = createServiceRoleClient();
  const { error } = await db.rpc("submit_gym_visitor_lead", {
    p_organization_id: v.organizationId,
    p_exercise_library_id: v.exerciseLibraryId,
    p_full_name: v.fullName,
    p_contact_info: v.contactInfo,
    p_note: v.note,
  });
  if (error) {
    console.error("submit_gym_visitor_lead failed:", error.message);
    return NextResponse.json({ error: "Something went wrong. Try again in a moment." }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
