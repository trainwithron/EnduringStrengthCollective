import { nameLooksLikeMessage, normalizeEmail } from "@/lib/public-booking";

// The two public forms with no login: booking a discovery call with a coach, and leaving contact details at a gym's equipment QR code.
// Both used to call the database straight from the visitor's browser, which meant anyone could call them as fast and as often as they
// liked, with any coach id, any time, any length. They now go through server routes that use these rules and a rate limit.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_DAYS_AHEAD = 90;

type Ok<T> = { ok: true; value: T };
type Bad = { ok: false; error: string };

function text(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max + 1) : "";
}

export interface DiscoveryBookingInput {
  coachId: string;
  startAt: string;
  endAt: string;
  name: string;
  email: string;
  phone: string | null;
  message: string | null;
}

export function validateDiscoveryBooking(raw: Record<string, unknown>, now: Date = new Date()): Ok<DiscoveryBookingInput> | Bad {
  const coachId = typeof raw.coachId === "string" ? raw.coachId : "";
  if (!UUID.test(coachId)) return { ok: false, error: "This booking link isn't valid." };
  const start = new Date(typeof raw.startAt === "string" ? raw.startAt : "");
  const end = new Date(typeof raw.endAt === "string" ? raw.endAt : "");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return { ok: false, error: "Pick a time." };
  if (start.getTime() <= now.getTime()) return { ok: false, error: "That time has passed. Pick another." };
  if (start.getTime() > now.getTime() + MAX_DAYS_AHEAD * 86400000) return { ok: false, error: "That is too far ahead. Pick a nearer date." };
  const minutes = (end.getTime() - start.getTime()) / 60000;
  if (minutes < 10 || minutes > 180) return { ok: false, error: "That time isn't valid. Pick another." };

  const name = text(raw.name, 80);
  if (!name || name.length > 80) return { ok: false, error: "Enter your name (80 characters or fewer)." };
  if (nameLooksLikeMessage(name)) return { ok: false, error: "Enter just your name, without links or contact details." };
  const email = typeof raw.email === "string" ? normalizeEmail(raw.email) : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, error: "Enter a valid email address." };
  const phone = text(raw.phone, 30);
  if (phone && (phone.length > 30 || !/^[0-9+\-()\s.]+$/.test(phone))) return { ok: false, error: "That phone number doesn't look right." };
  const message = text(raw.message, 500);
  if (message.length > 500) return { ok: false, error: "Keep your message under 500 characters." };

  return { ok: true, value: { coachId, startAt: start.toISOString(), endAt: end.toISOString(), name, email, phone: phone || null, message: message || null } };
}

export interface GymLeadInput {
  organizationId: string;
  exerciseLibraryId: string | null;
  fullName: string;
  contactInfo: string;
  note: string | null;
}

export function validateGymLead(raw: Record<string, unknown>): Ok<GymLeadInput> | Bad {
  const organizationId = typeof raw.organizationId === "string" ? raw.organizationId : "";
  if (!UUID.test(organizationId)) return { ok: false, error: "This link isn't valid." };
  const lib = typeof raw.exerciseLibraryId === "string" && raw.exerciseLibraryId ? raw.exerciseLibraryId : null;
  if (lib && !UUID.test(lib)) return { ok: false, error: "This link isn't valid." };
  const fullName = text(raw.fullName, 80);
  if (!fullName || fullName.length > 80) return { ok: false, error: "Enter your name (80 characters or fewer)." };
  if (nameLooksLikeMessage(fullName)) return { ok: false, error: "Enter just your name, without links." };
  const contactInfo = text(raw.contactInfo, 120);
  if (!contactInfo || contactInfo.length > 120) return { ok: false, error: "Enter a phone number or email (120 characters or fewer)." };
  const note = text(raw.note, 500);
  if (note.length > 500) return { ok: false, error: "Keep your note under 500 characters." };
  return { ok: true, value: { organizationId, exerciseLibraryId: lib, fullName, contactInfo, note: note || null } };
}
