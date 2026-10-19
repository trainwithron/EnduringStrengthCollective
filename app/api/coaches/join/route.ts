import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { clientIp, rateLimitResponse } from "@/lib/rate-limit";
import { validateNewPassword } from "@/lib/client-claim";
import { JOIN_LINK_COLUMNS, joinLinkState, parseJoinLinkToken, type JoinLinkRow } from "@/lib/coach-join-link";
import { loadSignInTarget } from "@/lib/coach-invite-server";

// The ONLY thing that uses up an invitation link: the invited person choosing their password on the join page. Opening the link (GET, HEAD, an email scanner, a message preview, a browser prefetch) never reaches this
// route. It checks the link (signature, not used, not cancelled, not ended), that the account is still the invited one and belongs to the organization that made the link, sets the password for THAT account only, and
// uses the link up in one step (a second press, or a second tab, finds it used). The browser then signs in with the password it just chose.
export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  const password = raw && typeof raw.password === "string" ? raw.password : "";
  const id = parseJoinLinkToken(raw?.token);
  const NOT_VALID = NextResponse.json({ error: "That link isn't valid. Ask whoever invited you to send it again." }, { status: 404 });
  if (!id) {
    const limitedBad = await rateLimitResponse("coach-join-bad", clientIp(request), 30, 3600);
    return limitedBad ?? NOT_VALID;
  }
  const limited = (await rateLimitResponse("coach-join-ip", clientIp(request), 60, 3600)) ?? (await rateLimitResponse("coach-join", id, 20, 3600));
  if (limited) return limited;

  const passwordError = validateNewPassword(password);
  if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 });

  const db = createServiceRoleClient();
  const { data: found, error: readError } = await db.from("coach_join_links").select(JOIN_LINK_COLUMNS).eq("id", id).maybeSingle();
  if (readError) return NextResponse.json({ error: "Couldn't check that link. Try again." }, { status: 502 });
  const row = found as JoinLinkRow | null;
  if (!row) return NOT_VALID;
  const state = joinLinkState(row);
  if (state === "used") return NextResponse.json({ error: "That link was already used. If you chose a password, sign in.", signIn: true }, { status: 409 });
  if (state === "revoked") return NOT_VALID;
  if (state === "expired") return NextResponse.json({ error: "That link has expired. Ask whoever invited you to send it again." }, { status: 410 });

  // the account must still belong to the organization that made the link (as a member or front desk, never the owner), and an unused invitation must still be one only this organization made
  const target = await loadSignInTarget(db, row.organization_id, row.profile_id);
  if (!target.ok) return NOT_VALID;
  // an invitation link only ever sets the password of an account that has not signed in; one that has gets a link of the other kind (emailed to its own address)
  if (row.kind === "invite" && !target.unaccepted) return NextResponse.json({ error: "You have already joined. Sign in with your password, or use Forgot password.", signIn: true }, { status: 409 });

  // used up first, in one step, so two presses cannot both set a password
  const { data: taken, error: takeError } = await db
    .from("coach_join_links")
    .update({ used_at: new Date().toISOString() })
    .eq("id", id)
    .is("used_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("id");
  if (takeError) return NextResponse.json({ error: "Couldn't finish. Try again." }, { status: 502 });
  if (!taken || taken.length === 0) return NextResponse.json({ error: "That link was already used. If you chose a password, sign in.", signIn: true }, { status: 409 });

  const { error: updateError } = await db.auth.admin.updateUserById(row.profile_id, { password, email_confirm: true });
  if (updateError) {
    console.error("coach join: password not saved", { link: id, message: updateError.message });
    // nothing changed on the account, so the link is given back and they can try again
    await db.from("coach_join_links").update({ used_at: null }).eq("id", id);
    return NextResponse.json({ error: "Couldn't save your password. Try again." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, email: target.email }, { headers: { "cache-control": "no-store" } });
}
