import { describe, expect, it } from "vitest";
import { hashClaimToken } from "@/lib/client-claim";
import {
  cancelManagedBooking,
  createPublicBooking,
  getManagedBooking,
  getOpenSlots,
  getPublicPage,
  managedBookingSlots,
  rescheduleManagedBooking,
  type ManagedBooking,
  type PublicBookingStore,
  type PublicCoachContext,
  type PublicPage,
} from "@/lib/public-booking-engine";
import type { PublicSessionTypeRow } from "@/lib/public-booking";

const NY = "America/New_York";
const NOW = new Date("2026-10-13T12:00:00Z"); // Tuesday 8:00 AM New York

interface Booking {
  id: string;
  coachId: string;
  athleteId: string;
  groupId: string;
  start: Date;
  end: Date;
  status: "confirmed" | "cancelled";
  sessionTypeId: string | null;
}

function fakeStore(opts: { page?: Partial<PublicPage>; types?: PublicSessionTypeRow[]; ctx?: Partial<PublicCoachContext> } = {}) {
  const page: PublicPage = { coachId: "c1", slug: "ron", enabled: true, headline: "Train with Ron", intro: null, showPrices: false, coachName: "Ron", ...opts.page };
  const types: PublicSessionTypeRow[] = opts.types ?? [
    { id: "t60", name: "Training session", durationMinutes: 60, locationKind: "in_person", locationText: null, description: null, displayPriceCents: 9500, publicVisible: true, sortOrder: 0 },
    { id: "hidden", name: "Internal check-in", durationMinutes: 30, locationKind: "online", locationText: null, description: null, displayPriceCents: null, publicVisible: false, sortOrder: 1 },
  ];
  const ctx: PublicCoachContext = {
    timezone: NY,
    bufferMinutes: 0,
    windows: [{ weekday: 2, startTime: "09:00", endTime: "12:00", slotDurationMinutes: 60 }],
    exceptions: [],
    minimumNoticeHours: 0,
    cancellationWindowHours: 24,
    ...opts.ctx,
  };
  const bookings = new Map<string, Booking>();
  const links = new Map<string, ManagedBooking & { tokenHash: string; guestPhone: string | null; note: string | null }>();
  const guests = new Map<string, { athleteId: string; groupId: string }>(); // by email
  const clients: { athleteId: string; groupId: string; name: string }[] = [];
  const mirrored: string[] = [];
  let n = 0;

  const store: PublicBookingStore = {
    async pageBySlug(slug) {
      return slug === page.slug ? page : null;
    },
    async coachName() {
      return page.coachName;
    },
    async sessionTypes() {
      return types;
    },
    async coachContext() {
      return ctx;
    },
    async busy(_c, from, to) {
      return [...bookings.values()].filter((b) => b.status === "confirmed" && b.start < to && b.end > from).map((b) => ({ start: b.start, end: b.end }));
    },
    async hasUpcomingPublicBooking(_coach, email, now) {
      return [...links.values()].some((l) => {
        const b = bookings.get(l.bookingId);
        return l.guestEmail === email && b?.status === "confirmed" && b.start > now;
      });
    },
    async findGuestClient(_coach, email) {
      return guests.get(email) ?? null;
    },
    async createGuestClient(_coach, name) {
      const athleteId = `a${++n}`;
      const groupId = `g${n}`;
      clients.push({ athleteId, groupId, name });
      return { ok: true as const, athleteId, groupId };
    },
    async discardGuestClient(athleteId) {
      const i = clients.findIndex((c) => c.athleteId === athleteId);
      if (i >= 0) clients.splice(i, 1);
    },
    async book({ coachId, athleteId, groupId, start, end, sessionTypeId }) {
      if ([...bookings.values()].some((b) => b.status === "confirmed" && b.start < end && b.end > start)) return { ok: false as const, message: "that slot was just taken" };
      const id = `b${++n}`;
      bookings.set(id, { id, coachId, athleteId, groupId, start, end, status: "confirmed", sessionTypeId });
      return { ok: true as const, bookingId: id };
    },
    async insertLink(a) {
      const b = bookings.get(a.bookingId)!;
      links.set(a.tokenHash, {
        linkId: `l${++n}`,
        bookingId: a.bookingId,
        coachId: a.coachId,
        athleteId: a.athleteId,
        groupId: b.groupId,
        guestName: a.guestName,
        guestEmail: a.guestEmail,
        startAt: b.start.toISOString(),
        endAt: b.end.toISOString(),
        status: b.status,
        sessionTypeId: b.sessionTypeId,
        sessionTypeName: types.find((t) => t.id === b.sessionTypeId)?.name ?? null,
        tokenHash: a.tokenHash,
        guestPhone: a.guestPhone,
        note: a.note,
      });
      guests.set(a.guestEmail, { athleteId: a.athleteId, groupId: b.groupId });
      return { ok: true as const };
    },
    async linkByHash(hash) {
      const l = links.get(hash);
      if (!l) return null;
      const b = bookings.get(l.bookingId)!;
      return { ...l, startAt: b.start.toISOString(), endAt: b.end.toISOString(), status: b.status };
    },
    async repointLink(linkId, bookingId) {
      for (const l of links.values()) if (l.linkId === linkId) l.bookingId = bookingId;
    },
    async cancel(bookingId) {
      const b = bookings.get(bookingId);
      if (!b || b.status !== "confirmed") return { ok: false as const, message: "not cancellable" };
      bookings.set(bookingId, { ...b, status: "cancelled" });
      return { ok: true as const };
    },
    async mirror(id) {
      mirrored.push(id);
    },
  };
  return { store, page, bookings, links, clients, mirrored };
}

// Next Tuesday 10:00 AM New York = 14:00Z.
const NEXT_TUE_10 = "2026-10-20T14:00:00.000Z";
const guestFields = { name: "Sam Lee", email: "Sam@Example.com", phone: "555-123-4567", note: "Bad knee", honeypot: "", renderedAtMs: NOW.getTime() - 20000 };
const request = (over: Record<string, unknown> = {}) => ({ slug: "ron", sessionTypeId: "t60", startIso: NEXT_TUE_10, ...guestFields, ...over });

describe("the public page", () => {
  it("shows the page with only public session types", async () => {
    const { store } = fakeStore();
    const view = await getPublicPage(store, "ron");
    expect(view?.coachName).toBe("Ron");
    expect(view?.sessionTypes.map((t) => t.id)).toEqual(["t60"]);
  });

  it("hides prices unless the coach switched them on", async () => {
    const off = await getPublicPage(fakeStore().store, "ron");
    expect(off?.sessionTypes[0].priceLabel).toBeNull();
    const on = await getPublicPage(fakeStore({ page: { showPrices: true } }).store, "ron");
    expect(on?.sessionTypes[0].priceLabel).toBe("$95");
  });

  it("a page that is switched off or unknown is simply not there", async () => {
    expect(await getPublicPage(fakeStore({ page: { enabled: false } }).store, "ron")).toBeNull();
    expect(await getPublicPage(fakeStore().store, "nobody")).toBeNull();
  });
});

describe("open times", () => {
  it("lists real open times for a public session type", async () => {
    const { store } = fakeStore();
    const r = await getOpenSlots(store, "ron", "t60", NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.slots.some((s) => s.startIso === NEXT_TUE_10)).toBe(true);
  });

  it("refuses a session type that is not public", async () => {
    const r = await getOpenSlots(fakeStore().store, "ron", "hidden", NOW);
    expect(r.ok).toBe(false);
  });

  it("no longer offers a time that has been booked", async () => {
    const { store } = fakeStore();
    await createPublicBooking(store, request(), NOW);
    const r = await getOpenSlots(store, "ron", "t60", NOW);
    expect(r.ok && r.slots.some((s) => s.startIso === NEXT_TUE_10)).toBe(false);
  });
});

describe("booking", () => {
  it("books, creates a client record, and gives back a private link", async () => {
    const { store, bookings, links, clients, mirrored } = fakeStore();
    const r = await createPublicBooking(store, request(), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.startIso).toBe(NEXT_TUE_10);
    expect(r.endIso).toBe("2026-10-20T15:00:00.000Z");
    expect(r.guestEmail).toBe("sam@example.com");
    expect(clients).toHaveLength(1);
    expect(bookings.size).toBe(1);
    // Only the hash of the link is stored.
    expect(links.has(hashClaimToken(r.manageToken))).toBe(true);
    expect([...links.keys()].includes(r.manageToken)).toBe(false);
    expect(mirrored).toEqual([r.bookingId]);
  });

  it("refuses a bot (filled hidden field, or sent too fast)", async () => {
    const { store, bookings } = fakeStore();
    expect((await createPublicBooking(store, request({ honeypot: "http://spam" }), NOW)).ok).toBe(false);
    expect((await createPublicBooking(store, request({ renderedAtMs: NOW.getTime() - 300 }), NOW)).ok).toBe(false);
    expect(bookings.size).toBe(0);
  });

  it("refuses bad details without booking anything", async () => {
    const { store, bookings } = fakeStore();
    const r = await createPublicBooking(store, request({ email: "nope" }), NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
    expect(bookings.size).toBe(0);
  });

  it("refuses a time that is not one of the coach's real open times", async () => {
    const { store, bookings, clients } = fakeStore();
    for (const startIso of ["2026-10-20T14:30:00.000Z", "2026-10-21T14:00:00.000Z", "2026-10-20T20:00:00.000Z", "garbage"]) {
      const r = await createPublicBooking(store, request({ startIso }), NOW);
      expect(r.ok).toBe(false);
    }
    expect(bookings.size).toBe(0);
    expect(clients).toHaveLength(0);
  });

  it("refuses a session type that is not public", async () => {
    const r = await createPublicBooking(fakeStore().store, request({ sessionTypeId: "hidden" }), NOW);
    expect(r.ok).toBe(false);
  });

  it("refuses when the page is off", async () => {
    const r = await createPublicBooking(fakeStore({ page: { enabled: false } }).store, request(), NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(404);
  });

  it("one upcoming booking per email: a second is refused, even with different capitalization", async () => {
    const { store, bookings } = fakeStore();
    expect((await createPublicBooking(store, request(), NOW)).ok).toBe(true);
    const second = await createPublicBooking(store, request({ startIso: "2026-10-20T15:00:00.000Z", email: "SAM@EXAMPLE.COM" }), NOW);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/can.t book another session/);
    expect(bookings.size).toBe(1);
  });

  it("a different email can book a different time", async () => {
    const { store, bookings, clients } = fakeStore();
    await createPublicBooking(store, request(), NOW);
    const r = await createPublicBooking(store, request({ email: "pat@example.com", name: "Pat", startIso: "2026-10-20T15:00:00.000Z" }), NOW);
    expect(r.ok).toBe(true);
    expect(bookings.size).toBe(2);
    expect(clients).toHaveLength(2);
  });

  it("someone who booked before is the same person next time, not a new client", async () => {
    const { store, clients } = fakeStore();
    const first = await createPublicBooking(store, request(), NOW);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    await cancelManagedBooking(store, first.manageToken, NOW);
    const again = await createPublicBooking(store, request({ startIso: "2026-10-27T14:00:00.000Z" }), NOW);
    expect(again.ok).toBe(true);
    expect(clients).toHaveLength(1);
  });

  it("when two people race for one time, the second is told it was taken and leaves no stray client", async () => {
    const { store, clients, bookings } = fakeStore();
    // The time looks open when checked, then is taken before the booking lands.
    const realBook = store.book;
    store.book = async (a) => {
      await realBook({ ...a, athleteId: "other", groupId: "gx" });
      return realBook(a);
    };
    const r = await createPublicBooking(store, request(), NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(409);
    expect(clients).toHaveLength(0);
    expect([...bookings.values()].filter((b) => b.status === "confirmed")).toHaveLength(1);
  });

  it("honours the coach's minimum notice", async () => {
    const { store } = fakeStore({ ctx: { minimumNoticeHours: 24 * 14 } });
    const r = await createPublicBooking(store, request(), NOW);
    expect(r.ok).toBe(false);
  });
});

describe("manage link", () => {
  async function booked(over: Parameters<typeof fakeStore>[0] = {}) {
    const fx = fakeStore(over);
    const r = await createPublicBooking(fx.store, request(), NOW);
    if (!r.ok) throw new Error("setup failed");
    return { ...fx, token: r.manageToken, bookingId: r.bookingId };
  }

  it("shows the booking and says it can be changed", async () => {
    const { store, token } = await booked();
    const v = await getManagedBooking(store, token, NOW);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.coachName).toBe("Ron");
      expect(v.typeName).toBe("Training session");
      expect(v.canChange).toBe(true);
    }
  });

  it("a made-up link finds nothing", async () => {
    const { store } = await booked();
    expect((await getManagedBooking(store, "nope", NOW)).ok).toBe(false);
    expect((await cancelManagedBooking(store, "nope", NOW)).ok).toBe(false);
  });

  it("cancels and frees the time", async () => {
    const { store, token, bookings, bookingId } = await booked();
    const r = await cancelManagedBooking(store, token, NOW);
    expect(r.ok).toBe(true);
    expect(bookings.get(bookingId)?.status).toBe("cancelled");
    const slots = await getOpenSlots(store, "ron", "t60", NOW);
    expect(slots.ok && slots.slots.some((s) => s.startIso === NEXT_TUE_10)).toBe(true);
  });

  it("cannot cancel twice", async () => {
    const { store, token } = await booked();
    await cancelManagedBooking(store, token, NOW);
    expect((await cancelManagedBooking(store, token, NOW)).ok).toBe(false);
  });

  it("inside the cancellation window it cannot be changed by the visitor", async () => {
    const { store, token } = await booked();
    const dayBefore = new Date("2026-10-20T00:00:00Z"); // 14 hours before
    const v = await getManagedBooking(store, token, dayBefore);
    expect(v.ok && v.canChange).toBe(false);
    expect((await cancelManagedBooking(store, token, dayBefore)).ok).toBe(false);
    expect((await rescheduleManagedBooking(store, token, "2026-10-20T15:00:00.000Z", dayBefore)).ok).toBe(false);
  });

  it("moves the session to another open time and keeps the same link working", async () => {
    const { store, token, bookings } = await booked();
    const r = await rescheduleManagedBooking(store, token, "2026-10-20T15:00:00.000Z", NOW);
    expect(r.ok).toBe(true);
    const confirmed = [...bookings.values()].filter((b) => b.status === "confirmed");
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0].start.toISOString()).toBe("2026-10-20T15:00:00.000Z");
    const v = await getManagedBooking(store, token, NOW);
    expect(v.ok && v.startIso).toBe("2026-10-20T15:00:00.000Z");
  });

  it("will not move to a time that is not open", async () => {
    const { store, token, bookings } = await booked();
    expect((await rescheduleManagedBooking(store, token, "2026-10-20T14:30:00.000Z", NOW)).ok).toBe(false);
    expect([...bookings.values()].filter((b) => b.status === "confirmed")).toHaveLength(1);
  });

  it("will not move onto someone else's time", async () => {
    const { store, token } = await booked();
    await createPublicBooking(store, request({ email: "pat@example.com", name: "Pat", startIso: "2026-10-20T15:00:00.000Z" }), NOW);
    expect((await rescheduleManagedBooking(store, token, "2026-10-20T15:00:00.000Z", NOW)).ok).toBe(false);
  });

  it("the reschedule list does not treat the visitor's own time as taken", async () => {
    const { store, token } = await booked();
    const r = await managedBookingSlots(store, token, NOW);
    expect(r.ok && r.slots.some((s) => s.startIso === NEXT_TUE_10)).toBe(true);
  });
});
