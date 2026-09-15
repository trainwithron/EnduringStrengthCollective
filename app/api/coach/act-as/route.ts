import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { ACTING_AS_COOKIE, getEffectiveAthlete } from "@/lib/acting-as";

// Read-only status check, consolidated into CoachDesktopShell itself
// (stale_client_name_header_bug.md, root cause #2) so the "Viewing as
// {client}" signal shows on EVERY desktop page the shell wraps — not
// just the ~15 pages that happen to already call getEffectiveAthlete()
// for their own data-fetching (and not the ones, like Dashboard/Clients/
// Programs/Business, that never did). The httpOnly cookie can't be read
// client-side, so the shell calls this instead of duplicating the
// resolution logic.
export async function GET(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ isActingAsOther: false });

  const groupId = new URL(request.url).searchParams.get("groupId");
  if (!groupId) return NextResponse.json({ isActingAsOther: false });

  const effective = await getEffectiveAthlete(groupId, user.id);
  if (!effective.isActingAsOther) return NextResponse.json({ isActingAsOther: false });

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", effective.athleteId)
    .maybeSingle();

  return NextResponse.json({
    isActingAsOther: true,
    athleteName: profile?.full_name ?? "a client",
  });
}

// Writes only set which athlete id a page queries with — the actual
// read/write still runs through the signed-in coach's own RLS-scoped
// session, so this route doesn't need its own authorization check beyond
// "is signed in": if the athleteId/groupId pairing doesn't correspond to a
// client this coach actually coaches, every downstream query under that
// cookie simply returns nothing (RLS is the real boundary, not this
// cookie).
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { athleteId, groupId } = await request.json();
  if (!athleteId || !groupId) {
    return NextResponse.json({ error: "Missing athleteId or groupId." }, { status: 400 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(ACTING_AS_COOKIE, JSON.stringify({ athleteId, groupId }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ACTING_AS_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
