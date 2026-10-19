import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { computeProgramCardVisuals } from "@/lib/program-card-data";

// The Programs page's card charts, fetched by the browser AFTER the page has shown (SPEED, Oct 19, measured live: streaming them kept the tab loading 5 more seconds). At most a dozen programs;
// every read goes through the signed-in coach's row security, so a program they cannot see simply has no chart.
const MAX_CHART_PROGRAMS = 12;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const ids = (new URL(request.url).searchParams.get("ids") ?? "")
    .split(",")
    .filter((id) => UUID.test(id))
    .slice(0, MAX_CHART_PROGRAMS);
  if (ids.length === 0) return NextResponse.json({ visuals: {} });
  const visuals = await computeProgramCardVisuals(supabase, ids, user.id);
  return NextResponse.json({ visuals: Object.fromEntries(visuals) }, { headers: { "cache-control": "private, no-store" } });
}
