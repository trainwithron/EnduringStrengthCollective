import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { rateLimitResponse } from "@/lib/rate-limit";
import { confirmAction, undoAction } from "@/lib/assistant-actions-server";

// The second step of an Ask Spot settings change. The first step (app/api/assistant/navigate) only shows a before/after card and hands back a signed token;
// this route changes nothing unless it is given a token that this same coach was shown, less than ten minutes ago (or, for an undo, the one the change returned).
// The write runs under the coach's own sign-in, so the database's own rules still decide who may change what.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  const limited = await rateLimitResponse("assistant-action", user.id, 60, 3600);
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  const op = body?.op === "undo" ? "undo" : body?.op === "confirm" ? "confirm" : null;
  if (!op) return NextResponse.json({ error: "Unknown request." }, { status: 400 });

  try {
    const result = op === "confirm" ? await confirmAction(supabase, user.id, body.token) : await undoAction(supabase, user.id, body.token);
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  } catch {
    return NextResponse.json({ ok: false, message: "That didn't go through, so nothing was changed. Try again, or change it by hand in your settings." }, { status: 500 });
  }
}
