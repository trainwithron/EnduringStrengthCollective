import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { loadUnclaimedClient } from "@/lib/client-claim-server";
import { cleanPersonName } from "@/lib/clean-person-name";

// Fixing how a client's name is spelled (Oct 19 audit: three clients showed a different name on different screens; Johann is "Gorsek" on his profile and "Gorsik" on his space).
//   * A client who has NOT signed in: the coach sets the name on the account itself, and the client's one-on-one space is renamed to match, in one go.
//   * A client who HAS signed in: the name on the account is theirs and is never changed from here. The coach can only make the SPACE's name (the label the coach sees) match the name the client uses (matchSpace).
// Only the coach of that space can do either.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const groupId = typeof body?.groupId === "string" ? body.groupId : null;
  const athleteId = typeof body?.athleteId === "string" ? body.athleteId : null;
  const matchSpace = body?.matchSpace === true;
  if (!groupId || !athleteId) return NextResponse.json({ error: "Missing the client." }, { status: 400 });

  const serviceRole = createServiceRoleClient();
  const { data: caller } = await supabase.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", user.id).maybeSingle();
  if (caller?.role !== "coach") return NextResponse.json({ error: "Only this client's coach can do that." }, { status: 403 });
  const { data: member } = await serviceRole.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", athleteId).maybeSingle();
  if (member?.role !== "athlete") return NextResponse.json({ error: "Client not found in this group." }, { status: 404 });
  const { data: space } = await serviceRole.from("groups").select("group_kind").eq("id", groupId).maybeSingle();
  const isOneOnOne = (space as { group_kind?: string } | null)?.group_kind === "one_on_one";

  if (matchSpace) {
    if (!isOneOnOne) return NextResponse.json({ error: "Only a one-on-one space is named after its client." }, { status: 400 });
    const { data: profile } = await serviceRole.from("profiles").select("full_name").eq("id", athleteId).maybeSingle();
    const name = cleanPersonName((profile as { full_name?: string | null } | null)?.full_name);
    if (!name) return NextResponse.json({ error: "They have no name on their account yet." }, { status: 400 });
    const { error } = await serviceRole.from("groups").update({ name }).eq("id", groupId);
    if (error) return NextResponse.json({ error: "Couldn't rename the space. Try again." }, { status: 500 });
    return NextResponse.json({ ok: true, name });
  }

  const name = cleanPersonName(body?.fullName);
  if (!name) return NextResponse.json({ error: "Enter a name." }, { status: 400 });
  // The name on the account is only the coach's to set until the person has signed in (the same rule as correcting their email).
  const client = await loadUnclaimedClient(supabase, serviceRole, user.id, groupId, athleteId);
  if (!client.ok) return NextResponse.json({ error: client.error }, { status: client.status });
  const { error: profileError } = await serviceRole.from("profiles").update({ full_name: name }).eq("id", athleteId);
  if (profileError) return NextResponse.json({ error: "Couldn't save the name. Try again." }, { status: 500 });
  if (isOneOnOne) await serviceRole.from("groups").update({ name }).eq("id", groupId);
  return NextResponse.json({ ok: true, name });
}
