import { redirect } from "next/navigation";
import { NoAccess } from "@/components/shared/no-access";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { WebsiteSettings } from "@/components/coach/desktop/website-settings";
import { cleanSite, reviewsFromJson, type SiteBackground } from "@/lib/coach-site";

export default async function WebsitePage(props: { params: Promise<{ groupId: string }> }) {
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase.from("group_memberships").select("role").eq("group_id", params.groupId).eq("profile_id", user.id).maybeSingle();
  if (membership?.role !== "coach") return <NoAccess>Only coaches can edit a website.</NoAccess>;

  const [{ data: group }, { data: site }, { data: bookingPage }] = await Promise.all([
    supabase.from("groups").select("name").eq("id", params.groupId).maybeSingle(),
    supabase.from("coach_sites").select("*").eq("coach_id", user.id).maybeSingle(),
    supabase.from("coach_booking_pages").select("slug").eq("coach_id", user.id).maybeSingle(),
  ]);

  const content = cleanSite({
    headline: site?.headline ?? "",
    whoIHelp: site?.who_i_help ?? "",
    whatIDo: site?.what_i_do ?? "",
    whyLines: site?.why_lines ?? [],
    reviews: reviewsFromJson(site?.reviews),
    background: (site?.background as SiteBackground | undefined) ?? "dark",
  });

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="website">
      <div className="pb-6 border-b border-steel/20 mb-6">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">My website</h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">
          One short page for new clients, in your organization&apos;s colors. Nothing is public until you publish it.
        </p>
      </div>
      <WebsiteSettings
        coachId={user.id}
        slug={(bookingPage?.slug as string | null) ?? null}
        initial={{ ...content, heroPath: site?.hero_path ?? null, coverPath: site?.cover_path ?? null, published: !!site?.published }}
      />
    </CoachDesktopShell>
  );
}
