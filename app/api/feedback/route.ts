import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { sendPushToProfile } from "@/lib/send-push";
import { isSendGridConfigured, sendEmail } from "@/lib/sendgrid";

// A short "report a problem or suggest something" note from a signed-in person. Recorded with the page and device, then the
// platform admin is told right away (a push, and an email when a sender is configured). If the table is not there yet the
// person is still thanked and the admin is still told, so nothing a tester writes is lost.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in to send feedback." }, { status: 401 });

  const limited = await rateLimitResponse("feedback", user.id, 15, 3600);
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return NextResponse.json({ error: "Write a few words first." }, { status: 400 });
  if (message.length > 4000) {
    return NextResponse.json({ error: "That is a bit long. Keep it under 4000 characters." }, { status: 400 });
  }
  const kind = body.kind === "idea" ? "idea" : "problem";
  // Path only, whatever the browser sent: a query string or fragment can carry a token, an email or a name.
  const pagePath = typeof body.pagePath === "string" ? body.pagePath.split("?")[0].split("#")[0].slice(0, 300) : null;
  const viewport = typeof body.viewport === "string" ? body.viewport.slice(0, 40) : null;
  const userAgent = (request.headers.get("user-agent") ?? "").slice(0, 400);

  const serviceRole = createServiceRoleClient();
  const { data: profile } = await serviceRole.from("profiles").select("full_name").eq("id", user.id).maybeSingle();

  const { error: insertError } = await serviceRole.from("feedback_reports").insert({
    profile_id: user.id,
    kind,
    message,
    page_path: pagePath,
    user_agent: userAgent,
    viewport,
  });
  if (insertError) console.error("feedback not stored:", insertError.message);

  // Tell the platform admin(s).
  const { data: admins } = await serviceRole.from("profiles").select("id").eq("is_platform_admin", true);
  const who = profile?.full_name ?? "Someone";
  const headline = `${kind === "idea" ? "Idea" : "Problem"} from ${who}`;
  const preview = message.length > 140 ? `${message.slice(0, 140)}...` : message;
  for (const admin of admins ?? []) {
    await sendPushToProfile(serviceRole, admin.id as string, headline, preview, "/admin/feedback").catch(() => 0);
    if (isSendGridConfigured()) {
      const { data: authUser } = await serviceRole.auth.admin.getUserById(admin.id as string);
      const to = authUser?.user?.email;
      if (to) {
        await sendEmail(
          to,
          headline,
          `${message}\n\nPage: ${pagePath ?? "unknown"}\nScreen: ${viewport ?? "unknown"}\nDevice: ${userAgent}`
        ).catch(() => false);
      }
    }
  }

  return NextResponse.json({ ok: true });
}
