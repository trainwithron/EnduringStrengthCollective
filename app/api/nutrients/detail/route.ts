import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { getEffectiveAthlete } from "@/lib/acting-as";
import { dateKeyInZone, getGroupCoachTimezone } from "@/lib/timezone";
import { loadNutrientDetailFacts } from "@/lib/nutrient-detail-facts";

// One nutrient in depth, for the panel that opens over the food log (read only: it changes nothing). The same rules as the nutrient's own page: a client reads their own; a coach
// asks about a client (athleteId) who is an athlete of this group. Everything is read with the signed-in person's own access. Nothing here is sent to the AI.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const groupId = url.searchParams.get("groupId") ?? "";
  const key = url.searchParams.get("key") ?? "";
  const athleteParam = url.searchParams.get("athleteId");
  if (!groupId || !/^[a-z0-9_]{2,40}$/.test(key)) return NextResponse.json({ error: "Missing or invalid request." }, { status: 400 });

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: membership } = await supabase.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", user.id).maybeSingle();
  if (!membership) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const effective = await getEffectiveAthlete(groupId, user.id);
  const audience: "coach" | "client" = membership.role === "coach" && !effective.isActingAsOther ? "coach" : "client";

  let athleteId = effective.athleteId;
  let clientName: string | null = null;
  if (audience === "coach") {
    if (!athleteParam) return NextResponse.json({ error: "Missing or invalid request." }, { status: 400 });
    const { data: target } = await supabase.from("group_memberships").select("profile_id, profiles ( full_name )").eq("group_id", groupId).eq("profile_id", athleteParam).eq("role", "athlete").maybeSingle();
    if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
    athleteId = target.profile_id as string;
    clientName = ((target.profiles as unknown as { full_name: string | null } | null)?.full_name ?? null) || "this client";
  }

  const timezone = await getGroupCoachTimezone(supabase, groupId);
  const facts = await loadNutrientDetailFacts(supabase, { athleteId, key, todayKey: dateKeyInZone(timezone), audience, clientName });
  if (!facts) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(facts, { headers: { "Cache-Control": "no-store" } });
}
