import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_ORG_THEME, type ButtonShape, type DisplayFont, type BodyFont } from "@/lib/theme";

// Turns "Coast to Coast Fitness" into "coast-to-coast-fitness", appending
// a short random suffix if that slug is already taken (rare, but two
// prospective clients could share a name).
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Platform-admin-only: creates a brand-new organization, optionally
// starting from another org's branding (colors/fonts/button shape —
// deliberately NOT its logo/app icon, since those are specific to
// whichever business used to have them; a new client gets their own
// uploaded fresh), plus one empty starter group so there's somewhere to
// build immediately. The admin becomes the new org's owner and the
// starter group's coach.
export async function createOrganization(
  supabase: SupabaseClient,
  {
    name,
    starterGroupName,
    ownerId,
    templateOrgId,
  }: {
    name: string;
    starterGroupName: string;
    ownerId: string;
    templateOrgId?: string | null;
  }
): Promise<{ organizationId: string; groupId: string }> {
  let theme = {
    buttonShape: DEFAULT_ORG_THEME.buttonShape as ButtonShape,
    accentColor: DEFAULT_ORG_THEME.accentColor,
    backgroundColor: DEFAULT_ORG_THEME.backgroundColor,
    textColor: DEFAULT_ORG_THEME.textColor,
    fontDisplay: DEFAULT_ORG_THEME.fontDisplay as DisplayFont,
    fontBody: DEFAULT_ORG_THEME.fontBody as BodyFont,
  };

  if (templateOrgId) {
    const { data: template } = await supabase
      .from("organizations")
      .select("button_shape, accent_color, background_color, text_color, font_display, font_body")
      .eq("id", templateOrgId)
      .maybeSingle();
    if (template) {
      theme = {
        buttonShape: (template.button_shape as ButtonShape) ?? theme.buttonShape,
        accentColor: template.accent_color ?? theme.accentColor,
        backgroundColor: template.background_color ?? theme.backgroundColor,
        textColor: template.text_color ?? theme.textColor,
        fontDisplay: (template.font_display as DisplayFont) ?? theme.fontDisplay,
        fontBody: (template.font_body as BodyFont) ?? theme.fontBody,
      };
    }
  }

  const baseSlug = slugify(name) || "organization";
  const slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .insert({
      slug,
      name,
      owner_id: ownerId,
      button_shape: theme.buttonShape,
      accent_color: theme.accentColor,
      background_color: theme.backgroundColor,
      text_color: theme.textColor,
      font_display: theme.fontDisplay,
      font_body: theme.fontBody,
    })
    .select("id")
    .single();
  if (orgError || !org) throw new Error(orgError?.message ?? "Couldn't create the organization.");

  const { error: membershipError } = await supabase
    .from("organization_memberships")
    .insert({ organization_id: org.id, profile_id: ownerId, role: "owner" });
  if (membershipError) throw new Error(membershipError.message);

  const { data: group, error: groupError } = await supabase
    .from("groups")
    .insert({ name: starterGroupName, organization_id: org.id, created_by: ownerId })
    .select("id")
    .single();
  if (groupError || !group) throw new Error(groupError?.message ?? "Couldn't create the starter group.");

  const { error: groupMembershipError } = await supabase
    .from("group_memberships")
    .insert({ group_id: group.id, profile_id: ownerId, role: "coach" });
  if (groupMembershipError) throw new Error(groupMembershipError.message);

  return { organizationId: org.id, groupId: group.id };
}
