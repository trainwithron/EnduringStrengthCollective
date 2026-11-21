import { csvLine } from "@/lib/zip-store";
import { formatInTimezone } from "@/lib/format-in-timezone";
import { formatVoiceTime } from "@/lib/voice-note";

// Evidence for a card dispute ($6, Ron Nov 20): for ONE payment by one client, only facts the app holds, gathered for the coach to print or download and upload in Stripe's
// dispute screen themselves (nothing is sent to Stripe). It is read as the signed-in coach, so row security decides what is in it, and only for a coach of the space the payment
// was made in. Nothing about any other client is read: every query names this client.
//   the payment       credit_purchases: amount, date, sessions it gave, the package it was for
//   the package       coach_packages, as it is today (the app does not keep a copy of what the checkout page showed, and says so)
//   the waiver        client_intake (signed name, completed) and legal_acceptances (the waiver version and when it was accepted)
//   the sessions      bookings of this client in this space from the payment until the next payment (or today): booked on, status, attended or no-show
//   the messages      this coach's messages with this client in this space over the same time (words; a voice note is listed with its length)
export interface EvidencePayment {
  id: string;
  createdAt: string;
  amountCents: number;
  sessions: number;
  packageId: string | null;
  checkoutId: string | null;
  athleteId: string;
  groupId: string;
}

export interface EvidencePackage {
  name: string;
  billingType: string | null;
  kind: string | null;
  sessionsGranted: number | null;
  sessionsPerWeek: number | null;
  priceCents: number | null;
}

export interface EvidenceWaiver {
  signedName: string | null;
  accepted: boolean;
  completedAt: string | null;
  versions: { version: string; acceptedAt: string }[];
}

export interface EvidenceSession {
  startAt: string;
  endAt: string | null;
  bookedAt: string;
  status: string;
  noShow: boolean;
  lateCancel: boolean;
  attendedAt: string | null;
}

export interface EvidenceMessage {
  at: string;
  from: "client" | "coach";
  text: string;
}

export interface DisputeEvidence {
  clientName: string;
  coachName: string;
  spaceName: string;
  payment: EvidencePayment;
  windowEnd: string;
  windowEndIsNextPayment: boolean;
  pkg: EvidencePackage | null;
  waiver: EvidenceWaiver | null;
  sessions: EvidenceSession[];
  messages: EvidenceMessage[];
  // some part could not be read: the page and the files say so instead of looking complete
  incomplete: boolean;
}

export const EVIDENCE_LIMIT = 500;

export function money(cents: number | null | undefined): string {
  return cents == null ? "" : (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

// One plain word for what happened to a session, from the booking's own fields.
export function sessionOutcome(s: EvidenceSession, now: Date = new Date()): string {
  if (s.status === "cancelled") return s.lateCancel ? "Cancelled late" : "Cancelled";
  if (s.noShow) return "No-show";
  if (s.attendedAt) return "Attended";
  if (Date.parse(s.startAt) <= now.getTime()) return "Took place (not marked a no-show)";
  return "Booked, still to come";
}

export type EvidenceLoad = { ok: true; evidence: DisputeEvidence } | { ok: false; status: number; error: string };

// db: the signed-in coach's own client. packages: the server's client, used for exactly one read (the package row, which belongs to whichever coach of the space made it),
// after the coach has been checked and only for the package this payment names.
export async function loadDisputeEvidence(db: any, packages: any, args: { purchaseId: string; viewerId: string; now?: Date }): Promise<EvidenceLoad> {
  const now = args.now ?? new Date();
  const { data: row, error } = await db
    .from("credit_purchases")
    .select("id, created_at, amount_cents, credits_purchased, coach_package_id, stripe_checkout_session_id, athlete_id, group_id")
    .eq("id", args.purchaseId)
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: "Couldn't read the payment. Try again." };
  if (!row || !row.athlete_id) return { ok: false, status: 404, error: "That payment isn't there, or it isn't yours to see." };

  // Only a coach of the space the payment was made in.
  const { data: seat } = await db.from("group_memberships").select("role").eq("group_id", row.group_id).eq("profile_id", args.viewerId).maybeSingle();
  if (seat?.role !== "coach") return { ok: false, status: 403, error: "Only a coach of this client can gather this." };

  const payment: EvidencePayment = {
    id: row.id,
    createdAt: row.created_at,
    amountCents: row.amount_cents ?? 0,
    sessions: row.credits_purchased ?? 0,
    packageId: row.coach_package_id ?? null,
    checkoutId: row.stripe_checkout_session_id ?? null,
    athleteId: row.athlete_id,
    groupId: row.group_id,
  };
  let incomplete = false;

  const [next, people, group, intake, legal] = await Promise.all([
    db.from("credit_purchases").select("created_at").eq("athlete_id", payment.athleteId).eq("group_id", payment.groupId).gt("created_at", payment.createdAt).order("created_at", { ascending: true }).limit(1),
    db.from("profiles").select("id, full_name").in("id", [payment.athleteId, args.viewerId]),
    db.from("groups").select("name").eq("id", payment.groupId).maybeSingle(),
    db.from("client_intake").select("waiver_signed_name, waiver_accepted, completed_at").eq("athlete_id", payment.athleteId).maybeSingle(),
    db.from("legal_acceptances").select("version, accepted_at").eq("profile_id", payment.athleteId).eq("document", "waiver").order("accepted_at", { ascending: true }),
  ]);
  for (const r of [next, people, group, intake, legal]) if (r.error) incomplete = true;
  const nextAt = ((next.data ?? []) as { created_at: string }[])[0]?.created_at ?? null;
  const windowEnd = nextAt ?? now.toISOString();
  const names = new Map(((people.data ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name ?? ""]));

  const pair = `and(sender_id.eq.${args.viewerId},recipient_id.eq.${payment.athleteId}),and(sender_id.eq.${payment.athleteId},recipient_id.eq.${args.viewerId})`;
  const [bookings, dms] = await Promise.all([
    db
      .from("bookings")
      .select("start_at, end_at, created_at, status, no_show, late_cancel, attended_at")
      .eq("athlete_id", payment.athleteId)
      .eq("group_id", payment.groupId)
      .gte("start_at", payment.createdAt)
      .lt("start_at", windowEnd)
      .order("start_at", { ascending: true })
      .limit(EVIDENCE_LIMIT),
    db
      .from("direct_messages")
      .select("sender_id, body, created_at, voice_seconds")
      .eq("group_id", payment.groupId)
      .or(pair)
      .gte("created_at", payment.createdAt)
      .lt("created_at", windowEnd)
      .order("created_at", { ascending: true })
      .limit(EVIDENCE_LIMIT),
  ]);
  let messageRows = dms;
  // before migration 0464 there is no voice column; read the words alone
  if (dms.error) {
    messageRows = await db
      .from("direct_messages")
      .select("sender_id, body, created_at")
      .eq("group_id", payment.groupId)
      .or(pair)
      .gte("created_at", payment.createdAt)
      .lt("created_at", windowEnd)
      .order("created_at", { ascending: true })
      .limit(EVIDENCE_LIMIT);
  }
  if (bookings.error || messageRows.error) incomplete = true;
  if ((bookings.data ?? []).length >= EVIDENCE_LIMIT || (messageRows.data ?? []).length >= EVIDENCE_LIMIT) incomplete = true;

  let pkg: EvidencePackage | null = null;
  if (payment.packageId) {
    const { data: p, error: pError } = await packages
      .from("coach_packages")
      .select("name, billing_type, kind, sessions_granted, sessions_per_week, rate_cents, price_cents, coach_id")
      .eq("id", payment.packageId)
      .maybeSingle();
    if (pError) incomplete = true;
    // only a package of a coach of this space
    const { data: owner } = p ? await packages.from("group_memberships").select("role").eq("group_id", payment.groupId).eq("profile_id", p.coach_id).maybeSingle() : { data: null };
    if (p && owner?.role === "coach") {
      pkg = {
        name: p.name,
        billingType: p.billing_type ?? null,
        kind: p.kind ?? null,
        sessionsGranted: p.sessions_granted ?? null,
        sessionsPerWeek: p.sessions_per_week ?? null,
        priceCents: p.price_cents ?? p.rate_cents ?? null,
      };
    }
  }

  const i = intake.data as { waiver_signed_name: string | null; waiver_accepted: boolean | null; completed_at: string | null } | null;
  const versions = ((legal.data ?? []) as { version: string; accepted_at: string }[]).map((l) => ({ version: l.version, acceptedAt: l.accepted_at }));
  const waiver: EvidenceWaiver | null = i || versions.length > 0 ? { signedName: i?.waiver_signed_name ?? null, accepted: !!i?.waiver_accepted, completedAt: i?.completed_at ?? null, versions } : null;

  return {
    ok: true,
    evidence: {
      clientName: names.get(payment.athleteId) || "Client",
      coachName: names.get(args.viewerId) || "Coach",
      spaceName: (group.data as { name?: string } | null)?.name ?? "",
      payment,
      windowEnd,
      windowEndIsNextPayment: !!nextAt,
      pkg,
      waiver,
      sessions: ((bookings.data ?? []) as any[]).map((b) => ({
        startAt: b.start_at,
        endAt: b.end_at ?? null,
        bookedAt: b.created_at,
        status: b.status,
        noShow: !!b.no_show,
        lateCancel: !!b.late_cancel,
        attendedAt: b.attended_at ?? null,
      })),
      messages: ((messageRows.data ?? []) as any[]).map((m) => ({
        at: m.created_at,
        from: m.sender_id === payment.athleteId ? ("client" as const) : ("coach" as const),
        text: typeof m.voice_seconds === "number" && m.voice_seconds > 0 ? `Voice note (${formatVoiceTime(m.voice_seconds)})` : m.body,
      })),
      incomplete,
    },
  };
}

export function packageWhat(e: DisputeEvidence): string {
  const parts: string[] = [];
  if (e.pkg?.name) parts.push(e.pkg.name);
  if (e.payment.sessions > 0) parts.push(`${e.payment.sessions} session${e.payment.sessions === 1 ? "" : "s"}`);
  return parts.join(", ") || "A payment";
}

// The files in the download: one spreadsheet per part, and a short note on how to use them. Dates in the coach's own time zone.
export function evidenceFiles(e: DisputeEvidence, timeZone: string, uploadLine: string, now: Date = new Date()): { name: string; text: string }[] {
  const when = (iso: string | null) => (iso ? formatInTimezone(iso, timeZone, "dateTime") : "");
  const day = (iso: string | null) => (iso ? formatInTimezone(iso, timeZone, "date") : "");
  const files: { name: string; text: string }[] = [];
  files.push({
    name: "payment.csv",
    text:
      csvLine(["client", "paid_on", "amount", "for", "sessions_given", "checkout_reference", "time_zone"]) +
      csvLine([e.clientName, when(e.payment.createdAt), money(e.payment.amountCents), packageWhat(e), e.payment.sessions, e.payment.checkoutId ?? "", timeZone]),
  });
  files.push({
    name: "package.csv",
    text: e.pkg
      ? csvLine(["package", "billing", "kind", "sessions_given", "sessions_per_week", "price_today", "note"]) +
        csvLine([e.pkg.name, e.pkg.billingType ?? "", e.pkg.kind ?? "", e.pkg.sessionsGranted ?? "", e.pkg.sessionsPerWeek ?? "", money(e.pkg.priceCents), "The package as it is today. The app does not keep a copy of the checkout page."])
      : csvLine(["note"]) + csvLine(["No package is linked to this payment."]),
  });
  files.push({
    name: "waiver.csv",
    text: e.waiver
      ? csvLine(["signed_name", "accepted", "form_completed", "waiver_version", "version_accepted"]) +
        (e.waiver.versions.length > 0
          ? e.waiver.versions.map((v) => csvLine([e.waiver!.signedName ?? "", e.waiver!.accepted ? "yes" : "no", when(e.waiver!.completedAt), v.version, when(v.acceptedAt)])).join("")
          : csvLine([e.waiver.signedName ?? "", e.waiver.accepted ? "yes" : "no", when(e.waiver.completedAt), "", ""]))
      : csvLine(["note"]) + csvLine(["No signed waiver on file."]),
  });
  files.push({
    name: "sessions.csv",
    text:
      csvLine(["session_date", "starts", "ends", "booked_on", "what_happened", "marked_attended"]) +
      e.sessions.map((s) => csvLine([day(s.startAt), when(s.startAt), when(s.endAt), when(s.bookedAt), sessionOutcome(s, now), when(s.attendedAt)])).join(""),
  });
  files.push({
    name: "messages.csv",
    text: csvLine(["sent", "from", "message"]) + e.messages.map((m) => csvLine([when(m.at), m.from === "client" ? e.clientName : e.coachName, m.text])).join(""),
  });
  const notes = [
    `Evidence for a card dispute: ${e.clientName}, payment of ${money(e.payment.amountCents)} on ${day(e.payment.createdAt)}.`,
    `Sessions and messages run from the payment to ${e.windowEndIsNextPayment ? "their next payment" : "the day this was made"} (${day(e.windowEnd)}). Times are in ${timeZone}.`,
    "Only what Spotlight holds is here. Nothing was sent to Stripe.",
    uploadLine,
  ];
  if (e.incomplete) notes.unshift("INCOMPLETE: some of this could not be read. Download it again before you use it.");
  files.push({ name: "README.txt", text: notes.join("\r\n") + "\r\n" });
  return files;
}
