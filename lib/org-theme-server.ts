import { cookies } from "next/headers";
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
//
// `groupId`, when known (a group-scoped route can pass its own
// params.groupId), takes priority for resolving which organization to
// theme with. A coach who owns/admins more than one organization has
// more than one row in organization_memberships, so blindly picking
// "the" membership resolved to an arbitrary other org's colors/logo —
// this is what made the whole app's theme (not just its data) look like
// it belonged to a different organization.
export async function getViewerOrgTheme(groupId?: string): Promise<OrgTheme> {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return DEFAULT_ORG_THEME;

    let organizationId: string | null = null;

    // 1. An explicit groupId (passed by a group-scoped route) is the
    // most trustworthy signal — RLS on `groups` already gates this to
    // groups the viewer can actually see, so a forged/foreign id just
    // resolves to nothing rather than leaking another org's theme.
    if (groupId) {
      const { data: group } = await supabase
        .from("groups")
        .select("organization_id")
        .eq("id", groupId)
        .maybeSingle();
      organizationId = group?.organization_id ?? null;
    }

    // 2. No explicit groupId (root layout, manifest) — fall back to the
    // same last_group cookie CoachDesktopShell keeps current on every
    // mount, so at least the coach's most recently viewed group's org
    // themes the rest of the app instead of an arbitrary one.
    if (!organizationId) {
      const lastGroupCookie = (await cookies()).get("last_group")?.value;
      if (lastGroupCookie) {
        try {
          const parsed = JSON.parse(decodeURIComponent(lastGroupCookie));
          if (parsed?.id) {
            const { data: group } = await supabase
              .from("groups")
              .select("organization_id")
              .eq("id", parsed.id)
              .maybeSingle();
            organizationId = group?.organization_id ?? null;
          }
        } catch {
          // Malformed cookie — fall through to the membership-based guess.
        }
      }
    }

    // 3. Last resort — a coach with exactly one org membership (the
    // common case) still resolves correctly; a coach with several and no
    // last_group cookie yet (a brand-new tab before ever visiting a
    // group) gets an arbitrary one until they do.
    if (!organizationId) {
      const { data: membership } = await supabase
        .from("organization_memberships")
        .select("organization_id")
        .eq("profile_id", user.id)
        .limit(1)
        .maybeSingle();
      organizationId = membership?.organization_id ?? null;
    }

    // Athletes never get an organization_memberships row (that table is
    // org *staff* — coaches/owners — not clients), so this falls back to
    // deriving the org through whichever group they're actually in, the
    // same path app/intake/page.tsx already uses for the waiver. Without
    // this, every real athlete silently got the platform default theme
    // instead of their own coach's branding — see migration
    // 0127_org_branding_visible_to_athletes.sql for the matching RLS fix
    // this depends on.
    if (!organizationId) {
      const { data: groupMembership } = await supabase
        .from("group_memberships")
        .select("groups ( organization_id )")
        .eq("profile_id", user.id)
        .limit(1)
        .maybeSingle();
      organizationId = (groupMembership as any)?.groups?.organization_id ?? null;
    }
    if (!organizationId) return DEFAULT_ORG_THEME;

    const { data: org } = await supabase
      .from("organizations")
      .select("name, button_shape, accent_color, background_color, text_color, font_display, font_body, logo_url, app_icon_url")
      .eq("id", organizationId)
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
