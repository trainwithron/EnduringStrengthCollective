import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { orgGroupIdsOf } from "@/lib/coach-groups";
import { appOrigin } from "@/lib/app-url";
import { isEmailConfigured } from "@/lib/email";
import { rateLimitAllows, rateLimitResponse } from "@/lib/rate-limit";
import { loadCoachName, loadClaimTemplate, sendClaimEmail } from "@/lib/claim-email-send";
import { CLAIM_LINKS_ALL_MAX, CLAIM_LINKS_ALL_PER_SEND, liveLinkOrUnknown, loadClaimCandidates, sortClaimCandidates } from "@/lib/claim-links-all";
import { runPool } from "@/lib/run-pool";

export const maxDuration = 300;

// Email every client who has not signed in yet their own sign-in link, in one press (Ron, Nov 20, onboarding O2: a coach moving 40 clients in should not send 40 links one at a time). GET says how many
// would be emailed (for the confirm box); POST sends, only after the coach confirmed. Each person gets ONE email with their own link (a person with a link that still works is skipped, so nobody is chased),
// to the address already on their account, in the coach's own wording when they wrote one. Transactional (the account the coach made for them), never marketing. Only the coach's own clients in the
// organization the coach is working in, never a team player or anyone with a parent on file (lib/claim-links-all.ts).

async function authorize(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) } as const;
  const url = new URL(request.url);
  const groupId = url.searchParams.get("groupId") ?? "";
  if (!groupId) return { error: NextResponse.json({ error: "Missing the group." }, { status: 400 }) } as const;
  const { data: seat } = await supabase.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", user.id).maybeSingle();
  if (seat?.role !== "coach") return { error: NextResponse.json({ error: "Only coaches can send sign-in links." }, { status: 403 }) } as const;
  // The coach's own groups in the organization of the space they are standing in (read as the coach, so only groups they coach).
  const groupIds = await orgGroupIdsOf(supabase, user.id, groupId);
  return { supabase, user, groupIds: groupIds.length > 0 ? groupIds : [groupId] } as const;
}

export async function GET(request: Request) {
  const auth = await authorize(request);
  if ("error" in auth) return auth.error;
  // Its own budget (every Clients page asks once), generous enough for real browsing.
  const limited = await rateLimitResponse("email-claim-links-all-count", auth.user.id, 600, 3600);
  if (limited) return limited;
  const { candidates, failed, total } = await loadClaimCandidates(createServiceRoleClient(), auth.user.id, auth.groupIds);
  const sorted = sortClaimCandidates(candidates);
  return NextResponse.json({
    eligible: sorted.eligible.length,
    // more people than one look covers: the count is "at least"
    more: total > CLAIM_LINKS_ALL_MAX,
    perSend: CLAIM_LINKS_ALL_PER_SEND,
    noEmail: sorted.noEmail.length,
    alreadyLinked: sorted.alreadyLinked.length,
    emailReady: isEmailConfigured(),
    failed,
  });
}

export async function POST(request: Request) {
  const auth = await authorize(request);
  if ("error" in auth) return auth.error;
  const body = await request.json().catch(() => ({}));
  if (body?.confirm !== true) return NextResponse.json({ error: "Confirm first." }, { status: 400 });
  const limited = await rateLimitResponse("email-claim-links-all", auth.user.id, 5, 3600);
  if (limited) return limited;
  if (!isEmailConfigured()) return NextResponse.json({ error: "Email sending isn't set up yet. Send each link from the client's profile instead.", notConfigured: true }, { status: 503 });
  // One send at a time per coach (two tabs, or two buttons on one page): the second press waits for the first.
  if (!(await rateLimitAllows(`email-claim-links-all-lock:${auth.user.id}`, 1, 120))) {
    return NextResponse.json({ error: "Those emails are already being sent. Wait a couple of minutes, then press again for anyone left." }, { status: 429 });
  }

  const serviceRole = createServiceRoleClient();
  const { candidates, failed, total } = await loadClaimCandidates(serviceRole, auth.user.id, auth.groupIds);
  // Never send on a list that could not be read in full.
  if (failed) return NextResponse.json({ error: "Couldn't read your client list in full, so nothing was sent. Try again in a minute." }, { status: 502 });
  const sorted = sortClaimCandidates(candidates);
  const batch = sorted.eligible.slice(0, CLAIM_LINKS_ALL_PER_SEND);
  const [coachName, template] = await Promise.all([loadCoachName(serviceRole, auth.user.id), loadClaimTemplate(serviceRole, auth.user.id)]);
  const origin = appOrigin(request);

  let sent = 0;
  let notSent = 0;
  let overDaily = 0;
  let alreadySent = 0;
  await runPool(batch, 3, async (c) => {
    // A daily ceiling per coach on the platform's own sender, and the same per-person ceiling as the one-client button.
    if (!(await rateLimitAllows(`email-claim-links-all-day:${auth.user.id}`, 300, 86400))) {
      overDaily++;
      return;
    }
    if (!(await rateLimitAllows(`email-claim-link:${c.profileId}`, 5, 24 * 3600))) {
      notSent++;
      return;
    }
    // Checked again just before sending: a link made since the list was read (the one-client button, another device) is never replaced by this.
    if (await liveLinkOrUnknown(serviceRole, c.profileId)) {
      alreadySent++;
      return;
    }
    const result = await sendClaimEmail(serviceRole, { coachId: auth.user.id, athleteId: c.profileId, fullName: c.fullName, email: c.email!, origin, coachName, template });
    if (result.ok) sent++;
    else notSent++;
  });

  return NextResponse.json({
    sent,
    notSent,
    overDaily,
    alreadySent,
    // left for the next press: the eligible ones past this batch, plus any not looked at yet (more than 250 not signed in)
    remaining: Math.max(0, sorted.eligible.length - batch.length) + overDaily,
    more: total > CLAIM_LINKS_ALL_MAX,
    noEmail: sorted.noEmail.length,
    alreadyLinked: sorted.alreadyLinked.length,
  });
}
