import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { hashClaimToken } from "@/lib/client-claim";

// The public landing for a client's claim link. The link is single-use: the
// token is checked (unused, unexpired) and marked used, then the SERVER signs
// the client in — it asks Supabase for a one-time login code for that account
// and redeems it itself, setting the session cookies — and sends them to the
// set-password page. Nothing depends on Supabase's redirect allow-list or on
// the client's mail provider. No session exists beforehand, so the token is
// the credential; only its hash is stored, and a used/expired/unknown token
// just shows a friendly "ask your coach for a new link" page.
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const origin = new URL(request.url).origin;
  const invalid = NextResponse.redirect(`${origin}/claim-invalid`);

  if (!token || token.length < 20 || token.length > 200) return invalid;

  const serviceRole = createServiceRoleClient();

  // Atomically claim the token: only one request can flip used_at.
  const { data: invite } = await serviceRole
    .from("client_invites")
    .update({ used_at: new Date().toISOString() })
    .eq("token_hash", hashClaimToken(token))
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("athlete_id")
    .maybeSingle();
  if (!invite) return invalid;

  const { data: authUser } = await serviceRole.auth.admin.getUserById(invite.athlete_id);
  const email = authUser?.user?.email;
  if (!email) return invalid;

  const { data: link, error } = await serviceRole.auth.admin.generateLink({ type: "magiclink", email });
  const hashedToken = link?.properties?.hashed_token;
  if (error || !hashedToken) return invalid;

  // Redeem the one-time code here, with the cookie-backed server client, so
  // the session is set on this response.
  const supabase = await createServerClient();
  const { error: verifyError } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: hashedToken });
  if (verifyError) return invalid;

  return NextResponse.redirect(`${origin}/set-password`);
}
