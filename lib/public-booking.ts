import { addDaysToDateKey } from "@/lib/series-schedule";
import { dateKeyInZone } from "@/lib/timezone";
import {
  generateSlotsForDate,
  isSlotBufferBlocked,
  minimumNoticeBlockedRange,
  resolveBlockedRangesForDate,
  type AvailabilityWindow,
} from "@/lib/booking-slots";
import type { ExceptionRow } from "@/lib/series-schedule";

// The rules behind a coach's public booking page. Pure: no database, so every rule here is tested on its own.

// ---- the address ------------------------------------------------------------------------------------------------------
// Words that cannot be an address because they are, or could become, real pages under /book.
export const RESERVED_SLUGS = new Set([
  "manage", "new", "admin", "api", "app", "login", "signup", "claim", "invite", "join", "book", "booking", "bookings", "me",
  "help", "support", "terms", "privacy", "refunds", "beta", "settings", "dashboard", "groups", "coach", "coaches", "spotlight",
  "null", "undefined", "test",
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(s: string): boolean {
  return UUID.test(s);
}

// Turns whatever a coach typed into the shape an address can have: lowercase letters, digits and single dashes.
export function normalizeSlug(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

// Why an address cannot be used, or null if it can. (Whether someone else already has it is checked against the database.)
export function slugProblem(slug: string): string | null {
  if (slug.length < 3) return "Use at least 3 letters or numbers.";
  if (slug.length > 40) return "Use 40 characters or fewer.";
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug)) return "Use only lowercase letters, numbers and dashes, starting and ending with a letter or number.";
  if (RESERVED_SLUGS.has(slug)) return "That address is reserved. Pick another.";
  if (isUuid(slug)) return "That address looks like an id. Pick another.";
  return null;
}

// ---- what a visitor types ------------------------------------------------------------------------------------------
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface GuestInput {
  name: string;
  email: string;
  phone: string | null;
  note: string | null;
}

export function validateGuestInput(raw: { name?: unknown; email?: unknown; phone?: unknown; note?: unknown }): { ok: true; value: GuestInput } | { ok: false; error: string } {
  const name = typeof raw.name === "string" ? raw.name.trim().replace(/\s+/g, " ") : "";
  if (name.length < 1 || name.length > 80) return { ok: false, error: "Enter your name." };
  const email = typeof raw.email === "string" ? normalizeEmail(raw.email) : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, error: "Enter a valid email address." };
  const phoneRaw = typeof raw.phone === "string" ? raw.phone.trim() : "";
  if (phoneRaw && (phoneRaw.length > 30 || !/^[0-9+\-()\s.]+$/.test(phoneRaw))) return { ok: false, error: "That phone number doesn't look right." };
  const noteRaw = typeof raw.note === "string" ? raw.note.trim() : "";
  if (noteRaw.length > 500) return { ok: false, error: "Keep your note under 500 characters." };
  return { ok: true, value: { name, email, phone: phoneRaw || null, note: noteRaw || null } };
}

// A hidden field real people never fill, and a form that is submitted faster than a person could. Either marks a bot.
export function isBotSubmission(opts: { honeypot: unknown; renderedAtMs: unknown; now: Date; minSeconds?: number }): boolean {
  if (typeof opts.honeypot === "string" && opts.honeypot.trim() !== "") return true;
  if (typeof opts.renderedAtMs === "number" && Number.isFinite(opts.renderedAtMs)) {
    const elapsed = opts.now.getTime() - opts.renderedAtMs;
    if (elapsed < (opts.minSeconds ?? 2) * 1000) return true;
  }
  return false;
}

// ---- what is shown -------------------------------------------------------------------------------------------------
export interface PublicSessionTypeRow {
  id: string;
  name: string;
  durationMinutes: number;
  locationKind: "in_person" | "online" | "either";
  locationText: string | null;
  description: string | null;
  displayPriceCents: number | null;
  publicVisible: boolean;
  sortOrder: number;
}

export interface PublicSessionTypeView {
  id: string;
  name: string;
  durationMinutes: number;
  where: string;
  description: string | null;
  priceLabel: string | null;
}

export function whereLabel(kind: PublicSessionTypeRow["locationKind"], text: string | null): string {
  const base = kind === "online" ? "Online" : kind === "either" ? "In person or online" : "In person";
  return text && text.trim() ? `${base}: ${text.trim()}` : base;
}

// A price is only ever shown when the coach switched prices on for the page AND set one on that session type.
export function priceLabelFor(cents: number | null, showPrices: boolean): string | null {
  if (!showPrices || cents === null || cents === undefined) return null;
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

export function publicSessionTypes(rows: PublicSessionTypeRow[], showPrices: boolean): PublicSessionTypeView[] {
  return rows
    .filter((r) => r.publicVisible)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((r) => ({
      id: r.id,
      name: r.name,
      durationMinutes: r.durationMinutes,
      where: whereLabel(r.locationKind, r.locationText),
      description: r.description?.trim() || null,
      priceLabel: priceLabelFor(r.displayPriceCents, showPrices),
    }));
}

// ---- open times ------------------------------------------------------------------------------------------------------
export const PUBLIC_BOOKING_DAYS = 28;

export interface OpenSlot {
  dateKey: string; // the coach's calendar day
  startIso: string;
}

// Every time a visitor may pick for a session of `durationMinutes`: inside the coach's weekly hours, outside time off, not
// within the minimum notice, not overlapping (or too close to) anything already booked. Times are on the coach's own clock.
export function computePublicSlots(opts: {
  now: Date;
  timezone: string;
  durationMinutes: number;
  windows: AvailabilityWindow[];
  exceptions: ExceptionRow[];
  busy: { start: Date; end: Date }[];
  bufferMinutes: number;
  minimumNoticeHours: number;
  days?: number;
}): OpenSlot[] {
  const days = opts.days ?? PUBLIC_BOOKING_DAYS;
  const todayKey = dateKeyInZone(opts.timezone, opts.now);
  const notice = minimumNoticeBlockedRange(opts.now, opts.minimumNoticeHours);
  const out: OpenSlot[] = [];
  for (let i = 0; i < days; i++) {
    const dateKey = addDaysToDateKey(todayKey, i);
    const [y, m, d] = dateKey.split("-").map(Number);
    // The slot helpers read a Date's local calendar fields, so give them noon on the coach's own day.
    const dayDate = new Date(y, m - 1, d, 12, 0, 0);
    const blocked = resolveBlockedRangesForDate(dayDate, opts.exceptions, opts.timezone);
    if (notice) blocked.push(notice);
    // The coach's hours say WHEN they work; the session type says how long a booking is. Step through each window by it.
    const windows = opts.windows
      .filter((w) => w.weekday === dayDate.getDay())
      .map((w) => ({ ...w, slotDurationMinutes: opts.durationMinutes }));
    for (const slot of generateSlotsForDate(dayDate, windows, blocked, opts.timezone)) {
      if (slot.start.getTime() <= opts.now.getTime()) continue;
      const end = new Date(slot.start.getTime() + opts.durationMinutes * 60000);
      if (isSlotBufferBlocked(slot.start, end, opts.busy, opts.bufferMinutes)) continue;
      // Without a buffer, isSlotBufferBlocked says nothing, so check plain overlap too.
      if (opts.busy.some((b) => slot.start < b.end && end > b.start)) continue;
      out.push({ dateKey, startIso: slot.start.toISOString() });
    }
  }
  return out;
}

export function slotIsOffered(slots: OpenSlot[], startIso: string): boolean {
  const t = new Date(startIso).getTime();
  if (Number.isNaN(t)) return false;
  return slots.some((s) => new Date(s.startIso).getTime() === t);
}

// A visitor may change or cancel on their own until the coach's cancellation window; inside it they are asked to message.
export function guestChangeAllowed(startAt: Date, now: Date, windowHours: number): { allowed: boolean; reason: string | null } {
  if (startAt.getTime() <= now.getTime()) return { allowed: false, reason: "That session has already started." };
  if (startAt.getTime() - now.getTime() < Math.max(0, windowHours) * 3600000) {
    return { allowed: false, reason: `This session is less than ${windowHours} hours away, so it can't be changed here. Please contact your coach.` };
  }
  return { allowed: true, reason: null };
}
