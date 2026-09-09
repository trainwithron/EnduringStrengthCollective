import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { BrandingForm } from "@/components/coach/desktop/branding-form";
import type { ButtonShape, DisplayFont, BodyFont } from "@/lib/theme";

export default async function BrandingPage(
  props: {
    params: Promise<{ groupId: string }>;
  }
) {
  const params = await props.params;
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", params.groupId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (membership?.role !== "coach") {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">
          Only coaches can customize dashboard branding.
        </p>
      </main>
    );
  }

  const { data: group } = await supabase
    .from("groups")
    .select("name")
    .eq("id", params.groupId)
    .single();

  const { data: orgMembership } = await supabase
    .from("organization_memberships")
    .select("organization_id, role")
    .eq("profile_id", user.id)
    .limit(1)
    .maybeSingle();

  if (!orgMembership) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">
          You&apos;re not part of an organization yet.
        </p>
      </main>
    );
  }

  const { data: org } = await supabase
    .from("organizations")
    .select(
      "id, slug, name, owner_id, created_at, button_shape, accent_color, background_color, text_color, font_display, font_body, logo_url, app_icon_url"
    )
    .eq("id", orgMembership.organization_id)
    .maybeSingle();

  const { data: memberRows } = await supabase
    .from("organization_memberships")
    .select("profile_id, role, profiles ( full_name )")
    .eq("organization_id", orgMembership.organization_id)
    .order("role", { ascending: true });

  const members = (memberRows ?? []).map((m) => ({
    profileId: m.profile_id,
    role: m.role,
    fullName: (m.profiles as any)?.full_name ?? "Unknown",
  }));

  const isOwner = orgMembership.role === "owner";

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="branding">
      <div className="pb-6 border-b border-steel/20 mb-6">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">
          {org?.name ?? "Organization"}
        </h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">
          Every coach and group under this organization shares one identity — branding, and
          eventually billing, are set here rather than per-coach.
        </p>
      </div>

      <div className="border border-steel/20 p-4 mb-8 grid grid-cols-2 gap-6">
        <div>
          <p className="font-body text-[11px] text-steel uppercase tracking-wide mb-1">
            Organization
          </p>
          <p className="font-body text-sm">{org?.name}</p>
          <p className="font-body text-xs text-steel mt-0.5">/{org?.slug}</p>
          <p className="font-body text-xs text-steel mt-2">
            Created {org?.created_at ? new Date(org.created_at).toLocaleDateString() : "—"}
          </p>
        </div>
        <div>
          <p className="font-body text-[11px] text-steel uppercase tracking-wide mb-1">Members</p>
          <div className="space-y-1">
            {members.map((m) => (
              <p key={m.profileId} className="font-body text-sm flex items-center justify-between">
                <span>{m.fullName}</span>
                <span className="text-steel text-xs uppercase tracking-wide">{m.role}</span>
              </p>
            ))}
          </div>
        </div>
      </div>

      <h2 className="font-display uppercase text-lg tracking-wide mb-3 border-t border-steel/20 pt-6">
        Branding
      </h2>
      {isOwner ? (
        <BrandingForm
          organizationId={orgMembership.organization_id}
          initialButtonShape={(org?.button_shape as ButtonShape) ?? "sharp"}
          initialAccentColor={org?.accent_color ?? "#C4622D"}
          initialBackgroundColor={org?.background_color ?? "#1C1B1A"}
          initialTextColor={org?.text_color ?? "#EDE8E0"}
          initialFontDisplay={(org?.font_display as DisplayFont) ?? "Barlow Condensed"}
          initialFontBody={(org?.font_body as BodyFont) ?? "Inter"}
          initialLogoUrl={org?.logo_url ?? null}
          initialAppIconUrl={org?.app_icon_url ?? null}
        />
      ) : (
        <p className="font-body text-sm text-steel">
          Only {org?.name ?? "the organization"}&apos;s owner can change branding.
        </p>
      )}
    </CoachDesktopShell>
  );
}
