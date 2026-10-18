import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { appOrigin } from "@/lib/app-url";
import { makeAuthLink } from "@/lib/auth-mail";
import { authorizeInviteManager, loadInviteTarget } from "@/lib/coach-invite-server";

// A fresh one-time invitation link to copy and send yourself (a text message) when an email does not arrive. Making it replaces the earlier link. Only an owner or admin of the organization, only for a person
// who belongs to it and has not accepted yet. The link is a sign-in credential for that one person's new account: it is shown to the person inviting and never stored or logged.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const limited = await rateLimitResponse("coach-invite-link", user.id, 20, 3600);
  if (limited) return limited;

  const raw = await request.json().catch(() => null);
  const groupId = raw && typeof raw.groupId === "string" ? raw.groupId : "";
  const profileId = raw && typeof raw.profileId === "string" ? raw.profileId : "";
  const auth = await authorizeInviteManager(supabase, user.id, groupId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = createServiceRoleClient();
  const target = await loadInviteTarget(db, auth.manager.organizationId, profileId);
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: target.status });

  const made = await makeAuthLink(db, { type: "invite", email: target.email, redirectTo: `${appOrigin(request)}/set-password`, fullName: target.name });
  if (!made.link) return NextResponse.json({ error: "Couldn't make a new link. Try again in a few minutes." }, { status: 502 });
  return NextResponse.json({ link: made.link }, { headers: { "cache-control": "no-store" } });
}
