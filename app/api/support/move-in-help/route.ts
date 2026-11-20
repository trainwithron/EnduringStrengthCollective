import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { rateLimitResponse } from "@/lib/rate-limit";
import { alertPlatformAdmins } from "@/lib/cron-monitor";

// "Want a hand moving in?" (Ron, Nov 20, onboarding O5: the research found coaches praise a named person who moves them in, and Spotlight had no way to reach one from inside the app). A coach asks;
// the platform admin (Ron) is told by push and email with what the coach wrote, and replies by email. Nothing is moved by this; it only asks.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const limited = await rateLimitResponse("move-in-help", user.id, 3, 86400);
  if (limited) return limited;

  // Only a coach (someone with a business on Spotlight) asks for help moving their clients in.
  const { data: seat } = await supabase.from("organization_memberships").select("organization_id").eq("profile_id", user.id).limit(1);
  if ((seat ?? []).length === 0) return NextResponse.json({ error: "Only coaches can ask for this." }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
  const fromApp = clean(body?.fromApp, 60);
  const clients = clean(body?.clients, 20);
  const note = clean(body?.note, 500);

  const { data: me } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  const name = (me as { full_name?: string | null } | null)?.full_name?.trim() || "A coach";
  const lines = [
    `${name} (${user.email ?? "no email on file"}) asked for help moving into Spotlight.`,
    fromApp ? `Coming from: ${fromApp}` : null,
    clients ? `About how many clients: ${clients}` : null,
    note ? `Their note: ${note}` : null,
    "Reply to them by email to set it up.",
  ].filter(Boolean);
  await alertPlatformAdmins("A coach wants help moving in", lines.join("\n"));
  return NextResponse.json({ ok: true });
}
