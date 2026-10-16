import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { validDateOfBirth } from "@/lib/dob-gate";

// A coach adds a birthday for a client who has none on file (so the AI builder can build for their age). Only when there is NO birthday yet: a client's own date is never overwritten from here. The coach must coach the
// client's group; the date is checked like the client's own birthday step; everything is read from the database, nothing is taken on trust from the request except the date and the two ids.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const groupId = typeof body.groupId === "string" ? body.groupId : "";
  const athleteId = typeof body.athleteId === "string" ? body.athleteId : "";
  const dateOfBirth = typeof body.dateOfBirth === "string" ? body.dateOfBirth.trim() : "";
  if (!groupId || !athleteId) return NextResponse.json({ error: "Missing client." }, { status: 400 });
  if (!validDateOfBirth(dateOfBirth)) return NextResponse.json({ error: "Enter a real date, like 1990-04-23." }, { status: 400 });

  const { data: caller } = await supabase.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", user.id).maybeSingle();
  if (caller?.role !== "coach") return NextResponse.json({ error: "Only this client's coach can do that." }, { status: 403 });

  const admin = createServiceRoleClient();
  const { data: seat } = await admin.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", athleteId).maybeSingle();
  if (seat?.role !== "athlete") return NextResponse.json({ error: "Client not found in this group." }, { status: 404 });

  const { data: existing } = await admin.from("client_intake").select("date_of_birth").eq("athlete_id", athleteId).maybeSingle();
  if ((existing as { date_of_birth?: string | null } | null)?.date_of_birth) {
    return NextResponse.json({ error: "They already have a birthday on file." }, { status: 409 });
  }
  const write = existing
    ? await admin.from("client_intake").update({ date_of_birth: dateOfBirth }).eq("athlete_id", athleteId).select("athlete_id")
    : await admin.from("client_intake").insert({ athlete_id: athleteId, group_id: groupId, date_of_birth: dateOfBirth }).select("athlete_id");
  if (write.error || !write.data || write.data.length === 0) return NextResponse.json({ error: "Couldn't save the birthday. Try again." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
