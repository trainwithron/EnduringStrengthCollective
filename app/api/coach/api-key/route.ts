import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { generateApiKey, hashApiKey } from "@/lib/api-key";

// Generates (or regenerates) this coach's Zapier API key. The raw key
// is returned exactly once, here — coach_api_keys only ever stores the
// hash, so there's no "view your key again" flow; a coach who loses it
// just generates a new one, invalidating the old one immediately (a
// primary-key upsert on coach_id, one key per coach at a time).
export async function POST() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: coachRows } = await supabase
    .from("group_memberships")
    .select("group_id")
    .eq("profile_id", user.id)
    .eq("role", "coach")
    .limit(1);
  if (!coachRows || coachRows.length === 0) {
    return NextResponse.json({ error: "Only coaches can generate an API key." }, { status: 403 });
  }

  const apiKey = generateApiKey();
  const serviceRole = createServiceRoleClient();
  await serviceRole.from("coach_api_keys").upsert(
    { coach_id: user.id, api_key_hash: hashApiKey(apiKey), created_at: new Date().toISOString(), last_used_at: null },
    { onConflict: "coach_id" }
  );

  return NextResponse.json({ apiKey });
}
