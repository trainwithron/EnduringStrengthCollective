import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { chunk } from "@/lib/chunk";
import { sendPushToProfile } from "@/lib/send-push";
import { runPool } from "@/lib/run-pool";

const ANNOUNCEMENT_MAX = 500;

// An organization's owner or admin sends one short message to every coach in it: it appears in each coach's notifications. It is a message from a person to their own staff (not marketing), sent once per call,
// never to clients. The caller's role is checked here as the caller (row security), and the recipients are the organization's members read with the server key only after that check.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const raw = await request.json().catch(() => null);
  const body: { organizationId?: unknown; message?: unknown } = raw && typeof raw === "object" ? raw : {};
  const organizationId = typeof body.organizationId === "string" ? body.organizationId : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!organizationId || !message) return NextResponse.json({ error: "Write the message first." }, { status: 400 });
  if (message.length > ANNOUNCEMENT_MAX) return NextResponse.json({ error: `Keep it to ${ANNOUNCEMENT_MAX} characters or fewer.` }, { status: 400 });

  const { data: mine } = await supabase.from("organization_memberships").select("role").eq("organization_id", organizationId).eq("profile_id", user.id).maybeSingle();
  if (mine?.role !== "owner" && mine?.role !== "admin") return NextResponse.json({ error: "Only the owner and admins can announce to the team." }, { status: 403 });

  const limited = await rateLimitResponse("org-announce", user.id, 10, 86400);
  if (limited) return limited;

  const db = createServiceRoleClient();
  const { data: org } = await db.from("organizations").select("name").eq("id", organizationId).maybeSingle();
  const { data: members, error: memberError } = await db.from("organization_memberships").select("profile_id").eq("organization_id", organizationId).neq("profile_id", user.id);
  if (memberError) return NextResponse.json({ error: "Couldn't find your team. Try again." }, { status: 502 });
  const ids = ((members ?? []) as { profile_id: string }[]).map((m) => m.profile_id);
  if (ids.length === 0) return NextResponse.json({ error: "There is nobody else on the team yet." }, { status: 400 });

  const { data: sender } = await db.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  const from = (sender as { full_name?: string } | null)?.full_name ?? "Your organization";
  const text = `${from} (${(org as { name?: string } | null)?.name ?? "your organization"}): ${message}`;

  let sent = 0;
  let failed = 0;
  const delivered: string[] = []; // only members whose notice was written get the push too
  for (const group of chunk(ids, 100)) {
    const { error } = await db.from("notifications").insert(group.map((profile_id) => ({ profile_id, type: "org_announcement", body: text, link_path: "/dashboard" })));
    if (error) {
      console.error("[org announce] a batch of notifications was refused:", error.message);
      failed += group.length;
    } else {
      sent += group.length;
      delivered.push(...group);
    }
  }
  if (sent === 0) return NextResponse.json({ error: "Couldn't send it. Try again." }, { status: 502 });
  // The same message to their phones (best effort, a few at a time; quiet hours and private lock screens apply).
  await runPool(delivered, 8, async (id) => {
    await sendPushToProfile(db, id, `${(org as { name?: string } | null)?.name ?? "Your organization"}`, `${from}: ${message}`.slice(0, 140), "/dashboard").catch(() => 0);
  }, { deadlineMs: 20_000 });
  return NextResponse.json({ ok: true, sent, failed });
}
