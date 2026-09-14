import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import type { TermKey, TermOverride, TerminologyOverrides } from "@/lib/terminology";

// Persists one word-swap override to the coach's own organization. RLS
// (organizations_update_org_admin / organizations_update_owner) is the
// real authorization boundary — an org member who isn't an owner/admin
// gets a clean 403 rather than a silent no-op.
export async function PATCH(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const key = body?.key as TermKey | undefined;
  const override = (body?.override ?? null) as TermOverride | null;
  const groupId = body?.groupId as string | undefined;
  if (!key) {
    return NextResponse.json({ error: "Missing key." }, { status: 400 });
  }

  // Scoped to the group the coach was actually looking at when they made
  // this change, not a blind "whichever org this profile belongs to"
  // lookup — a coach who owns/admins more than one organization has more
  // than one row in organization_memberships, and an unscoped lookup here
  // would silently patch the wrong org's vocabulary. Falls back to the
  // old behavior if no groupId was sent (defensive; the client always
  // sends one now).
  let organizationId: string | null = null;
  if (groupId) {
    const { data: group } = await supabase
      .from("groups")
      .select("organization_id")
      .eq("id", groupId)
      .maybeSingle();
    organizationId = group?.organization_id ?? null;
  }
  if (!organizationId) {
    const { data: membership } = await supabase
      .from("organization_memberships")
      .select("organization_id")
      .eq("profile_id", user.id)
      .limit(1)
      .maybeSingle();
    organizationId = membership?.organization_id ?? null;
  }
  if (!organizationId) {
    return NextResponse.json({ error: "No organization found." }, { status: 404 });
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("terminology_overrides")
    .eq("id", organizationId)
    .maybeSingle();
  if (!org) {
    return NextResponse.json({ error: "Organization not found." }, { status: 404 });
  }

  const current = (org.terminology_overrides as TerminologyOverrides) ?? {};
  const next: TerminologyOverrides = { ...current };
  if (override) next[key] = override;
  else delete next[key];

  const { error } = await supabase
    .from("organizations")
    .update({ terminology_overrides: next })
    .eq("id", organizationId);

  if (error) {
    return NextResponse.json(
      { error: "Couldn't save — only an org owner or admin can change this." },
      { status: 403 }
    );
  }

  return NextResponse.json({ overrides: next });
}
