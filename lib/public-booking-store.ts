import { isRealCoach } from "@/lib/real-coach";
import { placeholderEmailFor } from "@/lib/client-claim";
import { rateLimitAllows } from "@/lib/rate-limit";
import { mirrorBookingToGoogleCalendar } from "@/lib/google-calendar-mirror-server";
import { supabaseSeriesStore } from "@/lib/series-store";
import type { ManagedBooking, PublicBookingStore, PublicCoachContext } from "@/lib/public-booking-engine";
import type { PublicSessionTypeRow } from "@/lib/public-booking";

// The real PublicBookingStore. Uses the service role: a visitor has no account, so nothing here goes through their login.
// Every public route checks its own inputs (lib/public-booking.ts) before reaching this.

// New visitors one coach's public page may add in 24 hours. Repeat visitors, found by email, do not count.
const MAX_NEW_GUESTS_PER_DAY = 15;

const NOT_READY = "Online booking is not switched on yet.";

function looksLikeMissingSchema(message: string | undefined): boolean {
  return !!message && /column|relation|schema cache|does not exist/i.test(message);
}

export function publicBookingStore(db: any): PublicBookingStore {
  const series = supabaseSeriesStore(db);

  return {
    async pageBySlug(slug) {
      const { data, error } = await db
        .from("coach_booking_pages")
        .select("coach_id, slug, enabled, headline, intro, show_prices, profiles ( full_name )")
        .eq("slug", slug)
        .maybeSingle();
      if (error || !data) return null;
      // Only someone who really coaches a group has a public page.
      if (!(await isRealCoach(db, data.coach_id))) return null;
      return {
        coachId: data.coach_id,
        slug: data.slug,
        enabled: !!data.enabled,
        headline: data.headline ?? null,
        intro: data.intro ?? null,
        showPrices: !!data.show_prices,
        coachName: (data as any).profiles?.full_name ?? "Your coach",
      };
    },

    async coachName(coachId) {
      const { data } = await db.from("profiles").select("full_name").eq("id", coachId).maybeSingle();
      return data?.full_name ?? null;
    },

    async sessionTypes(coachId): Promise<PublicSessionTypeRow[]> {
      const { data, error } = await db
        .from("session_types")
        .select("id, name, duration_minutes, location_kind, location_text, description, display_price_cents, public_visible, sort_order")
        .eq("coach_id", coachId)
        .eq("public_visible", true)
        .order("sort_order", { ascending: true });
      if (error) return [];
      return (data ?? []).map((r: any) => ({
        id: r.id,
        name: r.name,
        durationMinutes: r.duration_minutes,
        locationKind: r.location_kind,
        locationText: r.location_text ?? null,
        description: r.description ?? null,
        displayPriceCents: r.display_price_cents ?? null,
        publicVisible: !!r.public_visible,
        sortOrder: r.sort_order ?? 0,
      }));
    },

    async coachContext(coachId): Promise<PublicCoachContext> {
      const base = await series.coachContext(coachId);
      const { data: policy } = await db
        .from("coach_booking_policies")
        .select("minimum_notice_hours, cancellation_window_hours")
        .eq("coach_id", coachId)
        .maybeSingle();
      return {
        ...base,
        minimumNoticeHours: policy?.minimum_notice_hours ?? 0,
        cancellationWindowHours: policy?.cancellation_window_hours ?? 24,
      };
    },

    busy: series.busy,

    async hasUpcomingPublicBooking(coachId, email, now) {
      const { data } = await db
        .from("booking_manage_links")
        .select("id, bookings!inner ( status, start_at )")
        .eq("coach_id", coachId)
        .eq("guest_email", email)
        .eq("bookings.status", "confirmed")
        .gt("bookings.start_at", now.toISOString())
        .limit(1);
      return (data ?? []).length > 0;
    },

    async findGuestClient(coachId, email) {
      const { data } = await db
        .from("booking_manage_links")
        .select("athlete_id, bookings ( group_id )")
        .eq("coach_id", coachId)
        .eq("guest_email", email)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const groupId = (data as any)?.bookings?.group_id;
      if (!data || !groupId) return null;
      return { athleteId: data.athlete_id, groupId };
    },

    async allowNewGuestClient(coachId) {
      return rateLimitAllows(`pb-new-guest:${coachId}`, MAX_NEW_GUESTS_PER_DAY, 86400);
    },

    async createGuestClient(coachId, name) {
      const { data: membership } = await db
        .from("organization_memberships")
        .select("organization_id")
        .eq("profile_id", coachId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!membership) return { ok: false as const, message: "no organization" };

      const groupId = crypto.randomUUID();
      const { error: groupError } = await db
        .from("groups")
        .insert({ id: groupId, name, created_by: coachId, organization_id: membership.organization_id, group_kind: "one_on_one" });
      if (groupError) return { ok: false as const, message: groupError.message };
      const { error: coachError } = await db.from("group_memberships").insert({ group_id: groupId, profile_id: coachId, role: "coach" });
      if (coachError) {
        await db.from("groups").delete().eq("id", groupId);
        return { ok: false as const, message: coachError.message };
      }

      // The account uses a placeholder address that can never receive mail, exactly like a client the coach adds before they
      // have signed in. The visitor's real email stays on the booking as contact details; they choose their own when they
      // claim the account.
      const { data: created, error: createError } = await db.auth.admin.createUser({
        email: placeholderEmailFor(crypto.randomUUID()),
        email_confirm: true,
        user_metadata: { full_name: name },
      });
      if (createError || !created?.user) {
        await db.from("groups").delete().eq("id", groupId);
        return { ok: false as const, message: createError?.message ?? "could not create account" };
      }
      const athleteId = created.user.id;
      const { error: profileError } = await db.from("profiles").insert({ id: athleteId, full_name: name, intake_required: true, claimed_at: null });
      const { error: athleteError } = profileError ? { error: profileError } : await db.from("group_memberships").insert({ group_id: groupId, profile_id: athleteId, role: "athlete" });
      if (profileError || athleteError) {
        await db.auth.admin.deleteUser(athleteId).catch(() => {});
        await db.from("groups").delete().eq("id", groupId);
        return { ok: false as const, message: (profileError ?? athleteError)!.message };
      }
      return { ok: true as const, athleteId, groupId };
    },

    async discardGuestClient(athleteId, groupId) {
      await db.auth.admin.deleteUser(athleteId).catch(() => {});
      await db.from("groups").delete().eq("id", groupId);
    },

    async book({ coachId, athleteId, groupId, start, end, sessionTypeId }) {
      const { data: bookingId, error } = await db.rpc("book_session", {
        p_coach_id: coachId,
        p_athlete_id: athleteId,
        p_group_id: groupId,
        p_start_at: start.toISOString(),
        p_end_at: end.toISOString(),
      });
      if (error || !bookingId) return { ok: false as const, message: error?.message ?? "could not book" };
      // Which kind of session and where it came from. Best effort: the columns arrive with migration 0261.
      await db.from("bookings").update({ session_type_id: sessionTypeId, booked_via: "public_page" }).eq("id", bookingId);
      return { ok: true as const, bookingId: bookingId as string };
    },

    async insertLink(a) {
      const { error } = await db.from("booking_manage_links").insert({
        booking_id: a.bookingId,
        coach_id: a.coachId,
        athlete_id: a.athleteId,
        token_hash: a.tokenHash,
        guest_name: a.guestName,
        guest_email: a.guestEmail,
        guest_phone: a.guestPhone,
        note: a.note,
      });
      if (error) return { ok: false as const, message: looksLikeMissingSchema(error.message) ? NOT_READY : error.message };
      return { ok: true as const };
    },

    async linkByHash(tokenHash): Promise<ManagedBooking | null> {
      const { data, error } = await db
        .from("booking_manage_links")
        .select("id, booking_id, coach_id, athlete_id, guest_name, guest_email, bookings ( group_id, start_at, end_at, status, session_type_id, session_types ( name ) )")
        .eq("token_hash", tokenHash)
        .maybeSingle();
      if (error || !data || !(data as any).bookings) return null;
      const b = (data as any).bookings;
      return {
        linkId: data.id,
        bookingId: data.booking_id,
        coachId: data.coach_id,
        athleteId: data.athlete_id,
        groupId: b.group_id,
        guestName: data.guest_name,
        guestEmail: data.guest_email,
        startAt: b.start_at,
        endAt: b.end_at,
        status: b.status,
        sessionTypeId: b.session_type_id ?? null,
        sessionTypeName: b.session_types?.name ?? null,
      };
    },

    async repointLink(linkId, bookingId) {
      await db.from("booking_manage_links").update({ booking_id: bookingId }).eq("id", linkId);
    },

    async cancel(bookingId) {
      const { error } = await db.rpc("cancel_booking_and_refund_credit", { p_booking_id: bookingId });
      return error ? { ok: false as const, message: error.message } : { ok: true as const };
    },

    async mirror(bookingId) {
      try {
        await mirrorBookingToGoogleCalendar(db, bookingId);
      } catch {
        // Never blocks the booking.
      }
    },
  };
}
