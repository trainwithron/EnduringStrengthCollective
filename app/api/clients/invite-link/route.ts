import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { loadUnclaimedClient, mintClaimLink } from "@/lib/client-claim-server";
import { appOrigin } from "@/lib/app-url";

// Mints a single-use claim link for a client who hasn't signed in yet. The
// coach decides when to create it and sends it themselves (a text from their
// own phone, or copy/paste) — nothing is sent from here. Only the hash of
// the token is stored; creating a new link retires any earlier unused one.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { groupId, athleteId } = await request.json();
  if (!groupId || !athleteId) {
    return NextResponse.json({ error: "Missing groupId or athleteId." }, { status: 400 });
  }

  const serviceRole = createServiceRoleClient();
  const client = await loadUnclaimedClient(supabase, serviceRole, user.id, groupId, athleteId);
  if (!client.ok) return NextResponse.json({ error: client.error }, { status: client.status });

  const minted = await mintClaimLink(serviceRole, user.id, athleteId, appOrigin(request));
  if (!minted.ok) return NextResponse.json({ error: "Couldn't create the link — try again." }, { status: 500 });

  return NextResponse.json({
    link: minted.link,
    expiresAt: minted.expiresAt,
    clientName: client.fullName,
  });
}
