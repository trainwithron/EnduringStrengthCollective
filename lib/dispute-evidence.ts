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
//   the classes       group classes this client joined in the same time, when the payment gave sessions: a class takes one session from the same balance of this client in
//                     this space that the package fills (migration 0263: join, waiting list and attended all charge session_credits for the attendee's own space), so
//                     package sessions are what classes use
//   quick payments    the other card payments this client made to this space through a coach's Quick Payment (coach_quick_payments: written only by the Stripe webhook, from a
//                     Stripe checkout, so each has its checkout id; anything without one is left out)
// The classes and quick payments are read with the server's key, after the coach has been checked, and only for this client in this space (a coach's own row rules show
// only the classes they run and the quick payments they charged).
export type EvidenceKind = "package" | "quick";

export interface EvidencePayment {
  // package: a package or sessions payment (credit_purchases); quick: a coach's Quick Payment card charge (coach_quick_payments)
  kind: EvidenceKind;
  // a Quick Payment's own words for what it was for
  what: string | null;
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

export interface EvidenceClass {
  title: string;
  startAt: string;
  joinedAt: string;
  status: string;
  classStatus: string;
  sessionTaken: boolean;
  attendedAt: string | null;
}

export interface EvidenceQuickPayment {
  paidAt: string;
  amountCents: number;
  what: string;
  checkoutId: string;
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
  // null: the payment gave no sessions, so classes do not use it
  classes: EvidenceClass[] | null;
  quickPayments: EvidenceQuickPayment[];
  messages: EvidenceMessage[];
  // some part could not be read: the page and the files say so instead of looking complete
  incomplete: boolean;
}

export const EVIDENCE_LIMIT = 500;
export const QUICK_LIMIT = 100;

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

export function classOutcome(c: EvidenceClass, now: Date = new Date()): string {
  if (c.classStatus === "cancelled") return "Class cancelled";
  if (c.status === "attended") return "Attended";
  if (c.status === "cancelled") return "Left the class";
  if (Date.parse(c.startAt) <= now.getTime()) return "Joined (not marked attended)";
  return "Joined, still to come";
}

export type EvidenceLoad = { ok: true; evidence: DisputeEvidence } | { ok: false; status: number; error: string };

// db: the signed-in coach's own client. server: the server's client, used only after the coach has been checked, and only for this payment's package (which belongs to
// whichever coach of the space made it) and for this client's classes and Quick Payments in this space.
// A Quick Payment ({ kind: "quick", groupId }): the coach is checked in that space FIRST, and only then is the charge read with the server's key, by its id, in that space,
// and only when it is a Stripe card charge (a Stripe checkout id). Its window runs to the client's next payment of either kind in the space, or today.
export async function loadDisputeEvidence(
  db: any,
  server: any,
  args: { purchaseId: string; viewerId: string; kind?: EvidenceKind; groupId?: string; now?: Date }
): Promise<EvidenceLoad> {
  const now = args.now ?? new Date();
  const kind: EvidenceKind = args.kind ?? "package";
  const notThere: EvidenceLoad = { ok: false, status: 404, error: "That payment isn't there, or it isn't yours to see." };
  const notCoach: EvidenceLoad = { ok: false, status: 403, error: "Only a coach of this client can gather this." };
  const coachOf = async (groupId: string) => {
    const { data: seat } = await db.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", args.viewerId).maybeSingle();
    return seat?.role === "coach";
  };

  let payment: EvidencePayment;
  if (kind === "quick") {
    if (!args.groupId) return notThere;
    if (!(await coachOf(args.groupId))) return notCoach;
    const { data: q, error } = await server
      .from("coach_quick_payments")
      .select("id, created_at, amount_cents, description, stripe_checkout_session_id, athlete_id, group_id")
      .eq("id", args.purchaseId)
      .eq("group_id", args.groupId)
      .like("stripe_checkout_session_id", "cs_%")
      .maybeSingle();
    if (error) return { ok: false, status: 500, error: "Couldn't read the payment. Try again." };
    if (!q || !q.athlete_id || q.group_id !== args.groupId || !String(q.stripe_checkout_session_id ?? "").startsWith("cs_")) return notThere;
    payment = {
      kind,
      what: (q.description as string | null)?.trim() || null,
      id: q.id,
      createdAt: q.created_at,
      amountCents: q.amount_cents ?? 0,
      sessions: 0,
      packageId: null,
      checkoutId: q.stripe_checkout_session_id,
      athleteId: q.athlete_id,
      groupId: q.group_id,
    };
  } else {
    const { data: row, error } = await db
      .from("credit_purchases")
      .select("id, created_at, amount_cents, credits_purchased, coach_package_id, stripe_checkout_session_id, athlete_id, group_id")
      .eq("id", args.purchaseId)
      .maybeSingle();
    if (error) return { ok: false, status: 500, error: "Couldn't read the payment. Try again." };
    if (!row || !row.athlete_id) return notThere;
    // Only a coach of the space the payment was made in.
    if (!(await coachOf(row.group_id))) return notCoach;
    payment = {
      kind,
      what: null,
      id: row.id,
      createdAt: row.created_at,
      amountCents: row.amount_cents ?? 0,
      sessions: row.credits_purchased ?? 0,
      packageId: row.coach_package_id ?? null,
      checkoutId: row.stripe_checkout_session_id ?? null,
      athleteId: row.athlete_id,
      groupId: row.group_id,
    };
  }
  let incomplete = false;

  const [next, nextQuick, people, group, intake, legal] = await Promise.all([
    db.from("credit_purchases").select("created_at").eq("athlete_id", payment.athleteId).eq("group_id", payment.groupId).gt("created_at", payment.createdAt).order("created_at", { ascending: true }).limit(1),
    // a Quick Payment's window also ends at the client's next Quick Payment
    kind === "quick"
      ? server.from("coach_quick_payments").select("created_at").eq("athlete_id", payment.athleteId).eq("group_id", payment.groupId).like("stripe_checkout_session_id", "cs_%").gt("created_at", payment.createdAt).order("created_at", { ascending: true }).limit(1)
      : Promise.resolve({ data: [], error: null }),
    db.from("profiles").select("id, full_name").in("id", [payment.athleteId, args.viewerId]),
    db.from("groups").select("name").eq("id", payment.groupId).maybeSingle(),
    // athlete_id is the table's primary key (0116), so there is one form per person, whichever space it was filled in; filtering by this space would hide a waiver signed
    // in another. Read as a list, newest completed first, one row: never an error if that ever changes.
    db.from("client_intake").select("waiver_signed_name, waiver_accepted, completed_at").eq("athlete_id", payment.athleteId).order("completed_at", { ascending: false, nullsFirst: false }).limit(1),
    db.from("legal_acceptances").select("version, accepted_at").eq("profile_id", payment.athleteId).eq("document", "waiver").order("accepted_at", { ascending: true }),
  ]);
  for (const r of [next, nextQuick, people, group, intake, legal]) if (r.error) incomplete = true;
  const nextAt =
    [((next.data ?? []) as { created_at: string }[])[0]?.created_at, ((nextQuick.data ?? []) as { created_at: string }[])[0]?.created_at]
      .filter((x): x is string => typeof x === "string")
      .sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
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
    const { data: p, error: pError } = await server
      .from("coach_packages")
      .select("name, billing_type, kind, sessions_granted, sessions_per_week, rate_cents, price_cents, coach_id")
      .eq("id", payment.packageId)
      .maybeSingle();
    if (pError) incomplete = true;
    // only a package of a coach of this space
    const { data: owner } = p ? await server.from("group_memberships").select("role").eq("group_id", payment.groupId).eq("profile_id", p.coach_id).maybeSingle() : { data: null };
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

  // Group classes in the same time: for a package payment only when it gave sessions (classes take sessions from the balance it fills); for a Quick Payment always (the
  // client's sessions and classes around the charge). Waiting-list places took nothing and are left out.
  let classes: EvidenceClass[] | null = null;
  if (payment.kind === "quick" || payment.sessions > 0) {
    const { data: rows, error: classError } = await server
      .from("group_session_attendees")
      .select("status, credit_taken, attended_at, created_at, group_sessions!inner ( title, start_at, status )")
      .eq("athlete_id", payment.athleteId)
      .eq("group_id", payment.groupId)
      .neq("status", "waitlisted")
      .gte("group_sessions.start_at", payment.createdAt)
      .lt("group_sessions.start_at", windowEnd)
      .limit(EVIDENCE_LIMIT);
    if (classError) incomplete = true;
    if ((rows ?? []).length >= EVIDENCE_LIMIT) incomplete = true;
    classes = ((rows ?? []) as any[])
      .map((a) => {
        const s = Array.isArray(a.group_sessions) ? a.group_sessions[0] : a.group_sessions;
        return {
          title: s?.title ?? "Group class",
          startAt: s?.start_at ?? a.created_at,
          joinedAt: a.created_at,
          status: a.status,
          classStatus: s?.status ?? "scheduled",
          sessionTaken: !!a.credit_taken,
          attendedAt: a.attended_at ?? null,
        };
      })
      .sort((x, y) => x.startAt.localeCompare(y.startAt));
  }

  // The client's other Quick Payments in this space: Stripe card charges only (each has its Stripe checkout id); the disputed one itself is the payment above.
  const { data: quickRows, error: quickError } = await server
    .from("coach_quick_payments")
    .select("id, created_at, amount_cents, description, stripe_checkout_session_id")
    .eq("athlete_id", payment.athleteId)
    .eq("group_id", payment.groupId)
    .like("stripe_checkout_session_id", "cs_%")
    .order("created_at", { ascending: true })
    .limit(QUICK_LIMIT);
  if (quickError) incomplete = true;
  const quickPayments: EvidenceQuickPayment[] = ((quickRows ?? []) as any[])
    .filter((q) => typeof q.stripe_checkout_session_id === "string" && q.stripe_checkout_session_id.startsWith("cs_") && !(payment.kind === "quick" && q.id === payment.id))
    .map((q) => ({ paidAt: q.created_at, amountCents: q.amount_cents ?? 0, what: (q.description as string | null)?.trim() || "Quick payment", checkoutId: q.stripe_checkout_session_id }));

  const i = (((intake.data ?? []) as unknown[])[0] ?? null) as { waiver_signed_name: string | null; waiver_accepted: boolean | null; completed_at: string | null } | null;
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
      classes,
      quickPayments,
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
  if (e.payment.kind === "quick") return `Quick Payment: ${e.payment.what ?? "no description given"}`;
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
  if (e.classes) {
    files.push({
      name: "classes.csv",
      text:
        csvLine(["class", "class_date", "starts", "joined_on", "what_happened", "session_taken", "marked_attended"]) +
        e.classes.map((c) => csvLine([c.title, day(c.startAt), when(c.startAt), when(c.joinedAt), classOutcome(c, now), c.sessionTaken ? "yes" : "no", when(c.attendedAt)])).join(""),
    });
  }
  files.push({
    name: "quick-payments.csv",
    text: csvLine(["paid_on", "amount", "for", "checkout_reference"]) + e.quickPayments.map((q) => csvLine([when(q.paidAt), money(q.amountCents), q.what, q.checkoutId])).join(""),
  });
  files.push({
    name: "messages.csv",
    text: csvLine(["sent", "from", "message"]) + e.messages.map((m) => csvLine([when(m.at), m.from === "client" ? e.clientName : e.coachName, m.text])).join(""),
  });
  const notes = [
    `Evidence for a card dispute: ${e.clientName}, payment of ${money(e.payment.amountCents)} on ${day(e.payment.createdAt)}.`,
    `Sessions, classes and messages run from the payment to ${e.windowEndIsNextPayment ? "their next payment" : "the day this was made"} (${day(e.windowEnd)}). Times are in ${timeZone}.`,
    e.payment.kind === "quick"
      ? "This was a Quick Payment: the client's sessions, classes and messages around it are listed."
      : e.classes
        ? "Classes take a session from the same balance this payment filled."
        : "This payment gave no sessions, so classes are not part of it.",
    "Quick payments: every other card payment this client made in this space through Stripe.",
    "Only what Spotlight holds is here. Nothing was sent to Stripe.",
    uploadLine,
  ];
  if (e.incomplete) notes.unshift("INCOMPLETE: some of this could not be read. Download it again before you use it.");
  files.push({ name: "README.txt", text: notes.join("\r\n") + "\r\n" });
  return files;
}
