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

  // A single atomic RPC (migration 0096) instead of 4 sequential inserts —
  // a mid-sequence failure used to leave an orphan organization (or a
  // group with no coach) committed with no way to roll it back.
  const { data, error } = await supabase
    .rpc("create_organization_with_group", {
      p_name: name,
      p_slug: slug,
      p_starter_group_name: starterGroupName,
      p_owner_id: ownerId,
      p_button_shape: theme.buttonShape,
      p_accent_color: theme.accentColor,
      p_background_color: theme.backgroundColor,
      p_text_color: theme.textColor,
      p_font_display: theme.fontDisplay,
      p_font_body: theme.fontBody,
    })
    .single();
  if (error || !data) throw new Error(error?.message ?? "Couldn't create the organization.");

  const result = data as { organization_id: string; group_id: string };
  return { organizationId: result.organization_id, groupId: result.group_id };
}
