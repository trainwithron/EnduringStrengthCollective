import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { hashClaimToken } from "@/lib/client-claim";
import { clientIp, rateLimitAllows } from "@/lib/rate-limit";

// The public landing for a client's claim link.
//
// GET only LOOKS at the link and shows a "Continue" page; it never uses the
// link up and never touches anyone's session. Message apps, email scanners and
// link previewers all fetch links with GET before a person taps them, and a
// coach or tester opening the link on their own device must not be signed out
// of their own account just by looking. Only the POST behind the button
// signs the client in.
//
// POST order matters. The steps that can fail (look up the account, ask
// Supabase for a one-time code, redeem it) run FIRST; the link is marked used
// LAST. A failure part-way through therefore leaves the link working, so the
// client can simply tap Continue again instead of being stranded on "expired".
// No session exists beforehand, so the token is the credential; only its hash
// is stored.

const NO_STORE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" };

function page(html: string, status = 200) {
  return new NextResponse(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", ...NO_STORE },
  });
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function continuePage(action: string, message?: string) {
  return page(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Continue</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;background:#1C1B1A;color:#EDE8E0;font-family:Inter,system-ui,sans-serif}
  main{max-width:360px;text-align:center}
  h1{font-size:30px;line-height:1;margin:0;text-transform:uppercase;letter-spacing:.01em}
  p{color:#908B7E;font-size:15px;line-height:1.5;margin:12px 0 0}
  p.err{color:#EDE8E0;border:1px solid #D2703B;padding:10px 12px}
  button{margin-top:24px;width:100%;height:52px;border:0;background:#D2703B;color:#1C1B1A;font-size:18px;font-weight:700;text-transform:uppercase;letter-spacing:.02em;cursor:pointer}
</style></head><body><main>
<h1>Welcome</h1>
<p>Tap Continue to sign in and set up your account.</p>
${message ? `<p class="err">${message}</p>` : ""}
<form method="post" action="${escapeAttr(action)}" onsubmit="var b=this.querySelector('button');if(b.dataset.sent){return false;}b.dataset.sent='1';setTimeout(function(){b.disabled=true},0);"><button type="submit">Continue</button></form>
</main></body></html>`);
}

async function findUsableInvite(token: string) {
  const serviceRole = createServiceRoleClient();
  const { data: found } = await serviceRole
    .from("client_invites")
    .select("id, athlete_id")
    .eq("token_hash", hashClaimToken(token))
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (!found) return { serviceRole, invite: null };

  // A client who already signed in another way (a password reset, say) keeps no used link on file, so an
  // old link would still look valid. Once the account is claimed it is THEIR account: refuse, and retire
  // anything still open.
  const { data: profile } = await serviceRole
    .from("profiles")
    .select("claimed_at")
    .eq("id", found.athlete_id)
    .maybeSingle();
  if (!profile || profile.claimed_at) {
    await serviceRole
      .from("client_invites")
      .update({ used_at: new Date().toISOString() })
      .eq("athlete_id", found.athlete_id)
      .is("used_at", null);
    return { serviceRole, invite: null };
  }
  return { serviceRole, invite: found };
}

function tokenLooksValid(token: string | undefined): token is string {
  return !!token && token.length >= 20 && token.length <= 200;
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const origin = new URL(request.url).origin;
  if (!(await rateLimitAllows(`claim:${clientIp(request)}`, 60, 600))) return NextResponse.redirect(`${origin}/claim-invalid`);
  if (!tokenLooksValid(token)) return NextResponse.redirect(`${origin}/claim-invalid`);

  const { invite } = await findUsableInvite(token);
  if (!invite) return NextResponse.redirect(`${origin}/claim-invalid`);

  return continuePage(`/claim/${encodeURIComponent(token)}`);
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const origin = new URL(request.url).origin;
  const invalid = () => NextResponse.redirect(`${origin}/claim-invalid`, 303);
  if (!(await rateLimitAllows(`claim:${clientIp(request)}`, 60, 600))) return invalid();
  if (!tokenLooksValid(token)) return invalid();

  const { serviceRole, invite } = await findUsableInvite(token);
  if (!invite) return invalid();

  const retry = (why: string) => {
    console.error("claim sign-in failed (link left usable):", why);
    return continuePage(
      `/claim/${encodeURIComponent(token)}`,
      "Something went wrong on our side. Your link still works. Tap Continue to try again."
    );
  };

  // 1. The risky steps first. None of them uses the link up.
  const { data: authUser, error: userError } = await serviceRole.auth.admin.getUserById(invite.athlete_id);
  const email = authUser?.user?.email;
  if (userError || !email) return retry(userError?.message ?? "no email on account");

  const { data: link, error: linkError } = await serviceRole.auth.admin.generateLink({ type: "magiclink", email });
  const hashedToken = link?.properties?.hashed_token;
  if (linkError || !hashedToken) return retry(linkError?.message ?? "no hashed token");

  // Redeem the one-time code with the cookie-backed server client so the
  // session cookies are set on this response.
  const supabase = await createServerClient();
  const { error: verifyError } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: hashedToken });
  if (verifyError) return retry(verifyError.message);

  // 2. Only now use the link up. Exactly one request can flip used_at; if two
  //    taps race, the loser is signed back out and sent to the "expired" page.
  const { data: consumed, error: consumeError } = await serviceRole
    .from("client_invites")
    .update({ used_at: new Date().toISOString() })
    .eq("id", invite.id)
    .is("used_at", null)
    .select("id")
    .maybeSingle();
  if (consumeError) {
    await supabase.auth.signOut();
    return retry(consumeError.message);
  }
  if (!consumed) {
    // Another request used the link first. If that happened a moment ago it is almost certainly this same person
    // tapping twice, and both requests signed in the same account in the same browser: signing out here would sign
    // the winner out too, so carry on to the same next step. Anything older than that is a genuine reuse.
    const { data: used } = await serviceRole
      .from("client_invites")
      .select("used_at")
      .eq("id", invite.id)
      .maybeSingle();
    const usedAt = used?.used_at ? new Date(used.used_at as string).getTime() : 0;
    if (usedAt > 0 && Date.now() - usedAt <= 20_000) {
      return NextResponse.redirect(`${origin}/set-password`, 303);
    }
    await supabase.auth.signOut();
    return invalid();
  }

  return NextResponse.redirect(`${origin}/set-password`, 303);
}
