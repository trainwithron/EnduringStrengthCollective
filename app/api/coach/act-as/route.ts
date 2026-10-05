import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { ACTING_AS_COOKIE } from "@/lib/acting-as";

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
