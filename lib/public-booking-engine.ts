import { generateClaimToken, hashClaimToken } from "@/lib/client-claim";
import {
  computePublicSlots,
  guestChangeAllowed,
  isBotSubmission,
  publicSessionTypes,
  slotIsOffered,
  validateGuestInput,
  type OpenSlot,
  type PublicSessionTypeRow,
  type PublicSessionTypeView,
} from "@/lib/public-booking";
import type { CoachContext } from "@/lib/series-engine";

// What happens when a visitor books through a coach's public page, and when they later change or cancel with their private
// link. The decisions live here; reading and writing the database is behind PublicBookingStore so they can be tested.
//
// Rules worth knowing:
//   * The page must be switched on. A visitor sees only session types the coach marked public.
//   * The time is checked against the coach's real open times on the server. Whatever the browser sent is not trusted.
//   * One upcoming public booking per email per coach, so the same address cannot hold many slots.
//   * A visitor becomes a client record the coach can see (not signed in yet), found again next time by email, so repeat
//     visitors do not pile up as separate people. Their real email is kept only as contact details on the booking.
//   * A visitor's booking takes no session credit. The coach is the one who decides what it costs.

export interface PublicPage {
  coachId: string;
  slug: string;
  enabled: boolean;
  headline: string | null;
  intro: string | null;
  showPrices: boolean;
  coachName: string;
}

export interface PublicCoachContext extends CoachContext {
  minimumNoticeHours: number;
  cancellationWindowHours: number;
}

export interface ManagedBooking {
  linkId: string;
  bookingId: string;
  coachId: string;
  athleteId: string;
  groupId: string;
  guestName: string;
  guestEmail: string;
  startAt: string;
  endAt: string;
  status: string;
  sessionTypeId: string | null;
  sessionTypeName: string | null;
}

export interface PublicBookingStore {
  pageBySlug(slug: string): Promise<PublicPage | null>;
  coachName(coachId: string): Promise<string | null>;
  sessionTypes(coachId: string): Promise<PublicSessionTypeRow[]>;
  coachContext(coachId: string): Promise<PublicCoachContext>;
  busy(coachId: string, from: Date, to: Date): Promise<{ start: Date; end: Date }[]>;
  // The visitor already has an upcoming booking with this coach.
  hasUpcomingPublicBooking(coachId: string, email: string, now: Date): Promise<boolean>;
  findGuestClient(coachId: string, email: string): Promise<{ athleteId: string; groupId: string } | null>;
  // Counts one new visitor against the coach's daily limit; false once the limit is reached.
  allowNewGuestClient(coachId: string): Promise<boolean>;
  createGuestClient(coachId: string, name: string): Promise<{ ok: true; athleteId: string; groupId: string } | { ok: false; message: string }>;
  discardGuestClient(athleteId: string, groupId: string): Promise<void>;
  book(args: { coachId: string; athleteId: string; groupId: string; start: Date; end: Date; sessionTypeId: string | null }): Promise<
    { ok: true; bookingId: string } | { ok: false; message: string }
  >;
  insertLink(args: {
    bookingId: string;
    coachId: string;
    athleteId: string;
    tokenHash: string;
    guestName: string;
    guestEmail: string;
    guestPhone: string | null;
    note: string | null;
  }): Promise<{ ok: true } | { ok: false; message: string }>;
  linkByHash(tokenHash: string): Promise<ManagedBooking | null>;
  repointLink(linkId: string, bookingId: string): Promise<void>;
  cancel(bookingId: string): Promise<{ ok: true } | { ok: false; message: string }>;
  mirror(bookingId: string): Promise<void>;
}

export interface PublicPageView {
  coachName: string;
  headline: string | null;
  intro: string | null;
  sessionTypes: PublicSessionTypeView[];
}

export async function getPublicPage(store: PublicBookingStore, slug: string): Promise<PublicPageView | null> {
  const page = await store.pageBySlug(slug);
  if (!page || !page.enabled) return null;
  const types = await store.sessionTypes(page.coachId);
  return { coachName: page.coachName, headline: page.headline, intro: page.intro, sessionTypes: publicSessionTypes(types, page.showPrices) };
}

async function openSlotsFor(
  store: PublicBookingStore,
  coachId: string,
  durationMinutes: number,
  now: Date,
  ignoreBooking?: { start: Date; end: Date }
): Promise<{ slots: OpenSlot[]; timezone: string }> {
  const ctx = await store.coachContext(coachId);
  const from = new Date(now.getTime() - 86400000);
  const to = new Date(now.getTime() + 35 * 86400000);
  let busy = await store.busy(coachId, from, to);
  if (ignoreBooking) {
    busy = busy.filter((b) => !(b.start.getTime() === ignoreBooking.start.getTime() && b.end.getTime() === ignoreBooking.end.getTime()));
  }
  const slots = computePublicSlots({
    now,
    timezone: ctx.timezone,
    durationMinutes,
    windows: ctx.windows,
    exceptions: ctx.exceptions,
    busy,
    bufferMinutes: ctx.bufferMinutes,
    minimumNoticeHours: ctx.minimumNoticeHours,
  });
  return { slots, timezone: ctx.timezone };
}

export type SlotsResult = { ok: true; timezone: string; slots: OpenSlot[] } | { ok: false; status: number; error: string };

export async function getOpenSlots(store: PublicBookingStore, slug: string, sessionTypeId: string, now: Date = new Date()): Promise<SlotsResult> {
  const page = await store.pageBySlug(slug);
  if (!page || !page.enabled) return { ok: false, status: 404, error: "This booking page isn't available." };
  const types = await store.sessionTypes(page.coachId);
  const type = types.find((t) => t.id === sessionTypeId && t.publicVisible);
  if (!type) return { ok: false, status: 404, error: "That session isn't offered." };
  const { slots, timezone } = await openSlotsFor(store, page.coachId, type.durationMinutes, now);
  return { ok: true, timezone, slots };
}

export interface PublicBookingInput {
  slug: string;
  sessionTypeId: string;
  startIso: string;
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  note?: unknown;
  honeypot?: unknown;
  renderedAtMs?: unknown;
}

export type PublicBookingResult =
  | {
      ok: true;
      bookingId: string;
      coachId: string;
      groupId: string;
      manageToken: string;
      coachName: string;
      startIso: string;
      endIso: string;
      timezone: string;
      typeName: string;
      guestName: string;
      guestEmail: string;
    }
  | { ok: false; status: number; error: string };

export async function createPublicBooking(store: PublicBookingStore, input: PublicBookingInput, now: Date = new Date()): Promise<PublicBookingResult> {
  if (isBotSubmission({ honeypot: input.honeypot, renderedAtMs: input.renderedAtMs, now, requireRenderedAt: true })) {
    return { ok: false, status: 400, error: "That didn't go through. Please try again." };
  }
  const page = await store.pageBySlug(input.slug);
  if (!page || !page.enabled) return { ok: false, status: 404, error: "This booking page isn't available." };

  const guest = validateGuestInput(input);
  if (!guest.ok) return { ok: false, status: 400, error: guest.error };

  const types = await store.sessionTypes(page.coachId);
  const type = types.find((t) => t.id === input.sessionTypeId && t.publicVisible);
  if (!type) return { ok: false, status: 404, error: "That session isn't offered." };

  // The coach's real open times, worked out here. A time the browser made up, or one that has just been taken, is refused.
  const { slots, timezone } = await openSlotsFor(store, page.coachId, type.durationMinutes, now);
  if (!slotIsOffered(slots, input.startIso)) {
    return { ok: false, status: 409, error: "That time is no longer available. Please pick another." };
  }

  if (await store.hasUpcomingPublicBooking(page.coachId, guest.value.email, now)) {
    return { ok: false, status: 409, error: `This email can't book another session with ${page.coachName} right now. If you already have one booked, use your private link to change or cancel it.` };
  }

  // The visitor becomes a client record the coach can see. Found by email next time so repeat visitors stay one person.
  let created = false;
  let client = await store.findGuestClient(page.coachId, guest.value.email);
  if (!client) {
    // Each new visitor becomes a client record, so cap how many a page can add in a day. A returning visitor is not counted.
    if (!(await store.allowNewGuestClient(page.coachId))) {
      return { ok: false, status: 429, error: "This page can't take new visitors right now. Please try again tomorrow, or contact your coach directly." };
    }
    const made = await store.createGuestClient(page.coachId, guest.value.name);
    if (!made.ok) return { ok: false, status: 502, error: "We couldn't complete your booking. Please try again in a moment." };
    client = { athleteId: made.athleteId, groupId: made.groupId };
    created = true;
  }

  const start = new Date(input.startIso);
  const end = new Date(start.getTime() + type.durationMinutes * 60000);
  const booked = await store.book({ coachId: page.coachId, athleteId: client.athleteId, groupId: client.groupId, start, end, sessionTypeId: type.id });
  if (!booked.ok) {
    if (created) await store.discardGuestClient(client.athleteId, client.groupId);
    const taken = /taken/i.test(booked.message);
    return { ok: false, status: taken ? 409 : 502, error: taken ? "That time was just taken. Please pick another." : "We couldn't complete your booking. Please try again in a moment." };
  }

  const token = generateClaimToken();
  const linked = await store.insertLink({
    bookingId: booked.bookingId,
    coachId: page.coachId,
    athleteId: client.athleteId,
    tokenHash: hashClaimToken(token),
    guestName: guest.value.name,
    guestEmail: guest.value.email,
    guestPhone: guest.value.phone,
    note: guest.value.note,
  });
  if (!linked.ok) {
    // Without the link the visitor could never manage this booking, so undo it rather than leave an orphan.
    await store.cancel(booked.bookingId);
    if (created) await store.discardGuestClient(client.athleteId, client.groupId);
    return { ok: false, status: 502, error: "We couldn't complete your booking. Please try again in a moment." };
  }

  await store.mirror(booked.bookingId);
  return {
    ok: true,
    bookingId: booked.bookingId,
    coachId: page.coachId,
    groupId: client.groupId,
    manageToken: token,
    coachName: page.coachName,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    timezone,
    typeName: type.name,
    guestName: guest.value.name,
    guestEmail: guest.value.email,
  };
}

export type ManageView =
  | {
      ok: true;
      coachName: string;
      typeName: string | null;
      startIso: string;
      endIso: string;
      status: string;
      timezone: string;
      canChange: boolean;
      reason: string | null;
      guestName: string;
    }
  | { ok: false; status: number; error: string };

export async function getManagedBooking(store: PublicBookingStore, token: string, now: Date = new Date()): Promise<ManageView> {
  const link = await store.linkByHash(hashClaimToken(token));
  if (!link) return { ok: false, status: 404, error: "This link isn't valid." };
  const ctx = await store.coachContext(link.coachId);
  const coachName = (await store.coachName(link.coachId)) ?? "your coach";
  const change = link.status === "confirmed" ? guestChangeAllowed(new Date(link.startAt), now, ctx.cancellationWindowHours) : { allowed: false, reason: "This booking was cancelled." };
  return {
    ok: true,
    coachName,
    typeName: link.sessionTypeName,
    startIso: link.startAt,
    endIso: link.endAt,
    status: link.status,
    timezone: ctx.timezone,
    canChange: change.allowed,
    reason: change.reason,
    guestName: link.guestName,
  };
}

export async function cancelManagedBooking(store: PublicBookingStore, token: string, now: Date = new Date()): Promise<{ ok: boolean; message: string }> {
  const link = await store.linkByHash(hashClaimToken(token));
  if (!link) return { ok: false, message: "This link isn't valid." };
  if (link.status !== "confirmed") return { ok: false, message: "This booking was already cancelled." };
  const ctx = await store.coachContext(link.coachId);
  const change = guestChangeAllowed(new Date(link.startAt), now, ctx.cancellationWindowHours);
  if (!change.allowed) return { ok: false, message: change.reason ?? "This booking can't be changed here." };
  const r = await store.cancel(link.bookingId);
  if (!r.ok) return { ok: false, message: "We couldn't cancel it. Please try again." };
  await store.mirror(link.bookingId);
  return { ok: true, message: "Your session was cancelled." };
}

export async function managedBookingSlots(store: PublicBookingStore, token: string, now: Date = new Date()): Promise<SlotsResult> {
  const link = await store.linkByHash(hashClaimToken(token));
  if (!link || link.status !== "confirmed") return { ok: false, status: 404, error: "This link isn't valid." };
  const duration = Math.round((new Date(link.endAt).getTime() - new Date(link.startAt).getTime()) / 60000);
  // The visitor's own current time is not "taken" for them, so it can be moved a little.
  const { slots, timezone } = await openSlotsFor(store, link.coachId, duration, now, { start: new Date(link.startAt), end: new Date(link.endAt) });
  return { ok: true, timezone, slots };
}

export async function rescheduleManagedBooking(
  store: PublicBookingStore,
  token: string,
  newStartIso: string,
  now: Date = new Date()
): Promise<{ ok: boolean; message: string; startIso?: string }> {
  const link = await store.linkByHash(hashClaimToken(token));
  if (!link) return { ok: false, message: "This link isn't valid." };
  if (link.status !== "confirmed") return { ok: false, message: "This booking was cancelled, so it can't be moved." };
  const ctx = await store.coachContext(link.coachId);
  const change = guestChangeAllowed(new Date(link.startAt), now, ctx.cancellationWindowHours);
  if (!change.allowed) return { ok: false, message: change.reason ?? "This booking can't be changed here." };

  const oldStart = new Date(link.startAt);
  const oldEnd = new Date(link.endAt);
  const duration = Math.round((oldEnd.getTime() - oldStart.getTime()) / 60000);
  const { slots } = await openSlotsFor(store, link.coachId, duration, now, { start: oldStart, end: oldEnd });
  if (!slotIsOffered(slots, newStartIso)) return { ok: false, message: "That time is no longer available. Please pick another." };

  const newStart = new Date(newStartIso);
  const newEnd = new Date(newStart.getTime() + duration * 60000);
  const args = { coachId: link.coachId, athleteId: link.athleteId, groupId: link.groupId, sessionTypeId: link.sessionTypeId };
  const overlapsOld = newStart < oldEnd && newEnd > oldStart;

  let newBookingId: string;
  if (!overlapsOld) {
    const booked = await store.book({ ...args, start: newStart, end: newEnd });
    if (!booked.ok) return { ok: false, message: "That time was just taken. Please pick another." };
    newBookingId = booked.bookingId;
    const cancelled = await store.cancel(link.bookingId);
    if (!cancelled.ok) {
      await store.cancel(newBookingId);
      return { ok: false, message: "We couldn't move your session. Nothing was changed." };
    }
  } else {
    const cancelled = await store.cancel(link.bookingId);
    if (!cancelled.ok) return { ok: false, message: "We couldn't move your session. Nothing was changed." };
    const booked = await store.book({ ...args, start: newStart, end: newEnd });
    if (!booked.ok) {
      const restored = await store.book({ ...args, start: oldStart, end: oldEnd });
      if (restored.ok) {
        await store.repointLink(link.linkId, restored.bookingId);
        await store.mirror(restored.bookingId);
      }
      return { ok: false, message: "That time could not be booked. Your session stayed where it was." };
    }
    newBookingId = booked.bookingId;
  }

  await store.repointLink(link.linkId, newBookingId);
  await store.mirror(link.bookingId);
  await store.mirror(newBookingId);
  return { ok: true, message: "Your session was moved.", startIso: newStart.toISOString() };
}
