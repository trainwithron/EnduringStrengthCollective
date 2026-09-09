import { createServerClient } from "@/lib/supabase/server";
import {
  DEFAULT_ORG_THEME,
  type OrgTheme,
  type ButtonShape,
  type DisplayFont,
  type BodyFont,
} from "@/lib/theme";

// Resolves the current viewer's organization branding for whatever
// surface they're on — coach desktop or the athlete mobile app both read
// from this same row, so there is one visual identity per organization,
// not one per surface. Falls back to the built-in defaults for a
// signed-out visitor (marketing/login pages) or a user with no org yet.
export async function getViewerOrgTheme(): Promise<OrgTheme> {
  try {
    const supabase = createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return DEFAULT_ORG_THEME;

    const { data: membership } = await supabase
      .from("organization_memberships")
      .select("organization_id")
      .eq("profile_id", user.id)
      .limit(1)
      .maybeSingle();
    if (!membership) return DEFAULT_ORG_THEME;

    const { data: org } = await supabase
      .from("organizations")
      .select("name, button_shape, accent_color, background_color, text_color, font_display, font_body, logo_url, app_icon_url")
      .eq("id", membership.organization_id)
      .maybeSingle();
    if (!org) return DEFAULT_ORG_THEME;

    return {
      buttonShape: (org.button_shape as ButtonShape) ?? DEFAULT_ORG_THEME.buttonShape,
      accentColor: org.accent_color ?? DEFAULT_ORG_THEME.accentColor,
      backgroundColor: org.background_color ?? DEFAULT_ORG_THEME.backgroundColor,
      textColor: org.text_color ?? DEFAULT_ORG_THEME.textColor,
      fontDisplay: (org.font_display as DisplayFont) ?? DEFAULT_ORG_THEME.fontDisplay,
      fontBody: (org.font_body as BodyFont) ?? DEFAULT_ORG_THEME.fontBody,
      logoUrl: org.logo_url ?? null,
      appIconUrl: org.app_icon_url ?? null,
      orgName: org.name ?? null,
    };
  } catch {
    // Middleware-protected pages already redirect signed-out visitors
    // before rendering; this only guards the handful of public
    // pages (login, /share/[postId], etc.) against a missing session.
    return DEFAULT_ORG_THEME;
  }
}
