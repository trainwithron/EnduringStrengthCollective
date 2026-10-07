import Link from "next/link";
import { redirectOneOnOneToAnchor } from "@/lib/coach-wide-redirect";
import { NoAccess } from "@/components/shared/no-access";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { BookingPageSettings, type BookingPageRow } from "@/components/coach/desktop/booking-page-settings";
import { PublicSessionTypesEditor, type PublicTypeEditRow } from "@/components/coach/desktop/public-session-types-editor";
import { normalizeSlug, slugProblem } from "@/lib/public-booking";

// The coach's public booking page: the address people book at, and which session types they can pick. Coach-wide (one page
// per coach, not per group), like availability and session types. Needs migration 0261; until it is applied the page says so.
export default async function BookingPageSettingsPage(props: { params: Promise<{ groupId: string }> }) {
  const params = await props.params;
  await redirectOneOnOneToAnchor(params.groupId, "business/booking-page");
  const supabase = await createServerClient();
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
      <NoAccess>Only coaches can set up a booking page.</NoAccess>
    );
  }

  const [{ data: group }, { data: profile }, pageResult, typesResult, { count: windowCount }] = await Promise.all([
    supabase.from("groups").select("name").eq("id", params.groupId).single(),
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    supabase.from("coach_booking_pages").select("slug, enabled, headline, intro, show_prices").eq("coach_id", user.id).maybeSingle(),
    supabase
      .from("session_types")
      .select("id, name, duration_minutes, location_kind, location_text, description, display_price_cents, public_visible, sort_order")
      .eq("coach_id", user.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase.from("coach_availability_windows").select("id", { count: "exact", head: true }).eq("coach_id", user.id),
  ]);

  const notReady = !!pageResult.error || !!typesResult.error;

  const initialPage: BookingPageRow | null = pageResult.data
    ? {
        slug: pageResult.data.slug,
        enabled: !!pageResult.data.enabled,
        headline: pageResult.data.headline ?? "",
        intro: pageResult.data.intro ?? "",
        showPrices: !!pageResult.data.show_prices,
      }
    : null;

  const suggested = normalizeSlug(profile?.full_name ?? "");
  const suggestedSlug = suggested && !slugProblem(suggested) ? suggested : "";

  const types: PublicTypeEditRow[] = (typesResult.data ?? []).map((t: any) => ({
    id: t.id,
    name: t.name,
    durationMinutes: t.duration_minutes ?? 60,
    locationKind: t.location_kind ?? "in_person",
    locationText: t.location_text ?? "",
    description: t.description ?? "",
    displayPrice: t.display_price_cents == null ? "" : String(t.display_price_cents / 100),
    publicVisible: !!t.public_visible,
  }));

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="booking-page">
      <div className="pb-6 border-b border-steel/20 mb-6">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">Booking Page</h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">
          A page you can share anywhere. People pick a session and a time you are free, with no account. They get a private link to
          change or cancel, and you see them as a new client who hasn&apos;t signed in yet.
        </p>
      </div>

      {notReady ? (
        <p className="font-body text-sm text-steel">Online booking isn&apos;t switched on yet. It will appear here once it is.</p>
      ) : (
        <div className="space-y-10">
          {(windowCount ?? 0) === 0 && (
            <div className="border border-rust/40 px-4 py-3 max-w-2xl">
              <p className="font-body text-sm text-chalk">
                You haven&apos;t set your weekly hours, so nobody can book yet.{" "}
                <Link href={`/groups/${params.groupId}/availability`} className="underline">
                  Set your hours
                </Link>
              </p>
            </div>
          )}

          <section>
            <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-3">Your page</h2>
            <BookingPageSettings coachId={user.id} initial={initialPage} suggestedSlug={suggestedSlug} />
          </section>

          <section>
            <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-3">Sessions people can book</h2>
            <PublicSessionTypesEditor initialTypes={types} />
          </section>
        </div>
      )}
    </CoachDesktopShell>
  );
}
