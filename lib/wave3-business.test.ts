import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pushes: unknown[][] = [];
vi.mock("@/lib/push-notify", () => ({ notifyPush: (...args: unknown[]) => pushes.push(args) }));

import {
  HOLD_MS,
  VOICE_MAX_SECONDS,
  baseMimeType,
  canRecordVoice,
  formatVoiceTime,
  pickVoiceMimeType,
  releaseAction,
  voiceExtension,
  voiceNotePushTitle,
  voicePath,
  voiceSeconds,
} from "@/lib/voice-note";
import { sendVoiceNote } from "@/lib/direct-message-send";
import { SOURCES, collectExportFiles } from "@/lib/export-files";
import { STORAGE_FILES, pathBelongsToPerson } from "@/lib/account-deletion";
import { clientFailedPaymentLine, coachFailedPaymentLine, failedPayment, loadFailedPayment } from "@/lib/payment-failed";
import { recordNextAttempt } from "@/lib/payment-events";
import { DISPUTE_HELP, DISPUTE_UPLOAD_LINE, FAILED_CARD_HELP, PAUSE_CLIENT_HELP, PAUSE_CLIENT_LINE } from "@/lib/billing-help";
import { HELP_BY_SLUG } from "@/lib/help-articles";
import { evidenceFiles, loadDisputeEvidence, sessionOutcome, type DisputeEvidence } from "@/lib/dispute-evidence";
import { buildPayrollSnapshot, cleanNote, cleanRates, payrollCsv } from "@/lib/payroll-report";
import { isWriteRequest } from "@/lib/workspace-mutation";

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8").replace(/\r\n/g, "\n");

const ANN = "44444444-4444-4444-8444-444444444444";
const COACH = "22222222-2222-4222-8222-222222222222";
const G1 = "bbbbbbbb-0000-4000-8000-000000000001";
const FILE = "cccccccc-0000-4000-8000-000000000001";

// A stand-in for a database client: every query is recorded and answered by the test's handler (table, what was asked, whether one row was wanted).
interface Q {
  table: string;
  op: "select" | "insert" | "update" | "delete";
  cols: string;
  filters: Record<string, unknown>;
  payload?: unknown;
}
function fakeDb(handler: (q: Q, single: boolean) => { data: unknown; error: unknown }, storage?: Record<string, unknown>) {
  const calls: Q[] = [];
  const from = (table: string) => {
    const q: Q = { table, op: "select", cols: "", filters: {} };
    const run = (single: boolean) => {
      calls.push(q);
      return handler(q, single);
    };
    const b: any = {
      select(c: string) {
        if (q.op === "select") q.cols = c;
        return b;
      },
      insert(p: unknown) {
        q.op = "insert";
        q.payload = p;
        return b;
      },
      update(p: unknown) {
        q.op = "update";
        q.payload = p;
        return b;
      },
      delete() {
        q.op = "delete";
        return b;
      },
      eq: (k: string, v: unknown) => ((q.filters[k] = v), b),
      in: (k: string, v: unknown) => ((q.filters[`in:${k}`] = v), b),
      gt: (k: string, v: unknown) => ((q.filters[`gt:${k}`] = v), b),
      gte: (k: string, v: unknown) => ((q.filters[`gte:${k}`] = v), b),
      lt: (k: string, v: unknown) => ((q.filters[`lt:${k}`] = v), b),
      or: (v: string) => ((q.filters.or = v), b),
      not: () => b,
      is: (k: string, v: unknown) => ((q.filters[k] = v), b),
      order: () => b,
      limit: () => b,
      range: () => b,
      maybeSingle: () => Promise.resolve(run(true)),
      single: () => Promise.resolve(run(true)),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(run(false)).then(res, rej),
    };
    return b;
  };
  return { from, calls, storage };
}

describe("R7 voice notes: the small rules", () => {
  it("records in a format the bucket takes, in the browser's own order of preference", () => {
    expect(pickVoiceMimeType((t) => t === "audio/mp4")).toBe("audio/mp4");
    expect(pickVoiceMimeType((t) => t.startsWith("audio/webm"))).toBe("audio/webm;codecs=opus");
    expect(pickVoiceMimeType(() => false)).toBeNull();
    expect(pickVoiceMimeType(null)).toBeNull();
    expect(pickVoiceMimeType(() => {
      throw new Error("no");
    })).toBeNull();
    expect(baseMimeType("audio/webm;codecs=opus")).toBe("audio/webm");
    expect([voiceExtension("audio/webm;codecs=opus"), voiceExtension("audio/mp4"), voiceExtension("audio/ogg"), voiceExtension("video/mp4")]).toEqual(["webm", "m4a", "ogg", null]);
  });
  it("files it under the sender, then the space (the database holds the same rule)", () => {
    expect(voicePath(ANN, G1, FILE, "audio/webm")).toBe(`${ANN}/${G1}/${FILE}.webm`);
    expect(voicePath(ANN, G1, FILE, "text/plain")).toBeNull();
    const sql = read("supabase/migrations/0464_voice_notes_payroll_reports.sql");
    expect(sql).toContain("split_part(voice_path, '/', 1) = sender_id::text");
    expect(sql).toContain("voice_seconds between 1 and 120");
  });
  it("is at most two minutes, and an accidental tap is not a voice note", () => {
    expect(VOICE_MAX_SECONDS).toBe(120);
    expect(voiceSeconds(200)).toBeNull();
    expect(voiceSeconds(800)).toBe(1);
    expect(voiceSeconds(65_400)).toBe(65);
    expect(voiceSeconds(500_000)).toBe(120);
    expect([formatVoiceTime(7), formatVoiceTime(105), formatVoiceTime(120)]).toEqual(["0:07", "1:45", "2:00"]);
  });
  it("hold to talk sends when let go; a short tap keeps recording", () => {
    expect(releaseAction(HOLD_MS + 10)).toBe("send");
    expect(releaseAction(120)).toBe("keep");
  });
  it("the mic shows only where the browser can record, and asks for the microphone only when tapped", () => {
    expect(canRecordVoice(undefined)).toBe(false);
    expect(canRecordVoice({ navigator: { mediaDevices: { getUserMedia: () => null } } })).toBe(false);
    expect(canRecordVoice({ MediaRecorder: { isTypeSupported: () => true }, navigator: { mediaDevices: {} } })).toBe(false);
    expect(canRecordVoice({ MediaRecorder: { isTypeSupported: (t) => t === "audio/mp4" }, navigator: { mediaDevices: { getUserMedia: () => null } } })).toBe(true);
    const rec = read("components/messages/voice-note-recorder.tsx");
    expect(rec).toContain("if (!supported) return null;");
    // getUserMedia is called in one place: start(), which only a tap or press runs
    expect(rec.match(/getUserMedia\(/g)?.length).toBe(1);
    expect(rec.indexOf("getUserMedia(")).toBeGreaterThan(rec.indexOf("async function start()"));
    expect(rec).toContain("VOICE_MAX_SECONDS * 1000");
  });
  it("the conversation has the mic for coach and client alike, and plays a voice note in place of its words", () => {
    const thread = read("components/messages/direct-message-thread.tsx");
    expect(thread).toContain("<VoiceNoteRecorder");
    expect(thread).toContain("sendVoiceNote(createBrowserClient(), { groupId, senderId: viewerId, senderName: viewerName, recipientId: otherId, audio, mimeType, seconds })");
    expect(thread).toContain("<VoiceNotePlayer path={m.voice_path} seconds={m.voice_seconds} own={isOwn} />");
    const player = read("components/messages/voice-note-player.tsx");
    expect(player).toContain("createSignedUrl(path, VOICE_LINK_SECONDS)");
    expect(player).toContain('role="progressbar"');
    expect(read("lib/direct-thread.ts")).toContain("voice_path, voice_seconds");
  });
});

describe("R7 voice notes: the send", () => {
  beforeEach(() => {
    pushes.length = 0;
  });
  const audio = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
  function client(insertAnswer: { data: unknown; error: unknown }, uploadError: unknown = null) {
    const uploads: { path: string; type?: string }[] = [];
    const removed: string[][] = [];
    const db = fakeDb((q) => (q.table === "direct_messages" && q.op === "insert" ? insertAnswer : { data: null, error: null }));
    const storage = {
      from: (bucket: string) => ({
        upload: async (path: string, _b: Blob, o: { contentType?: string }) => {
          expect(bucket).toBe("voice-notes");
          uploads.push({ path, type: o.contentType });
          return { data: uploadError ? null : { path }, error: uploadError };
        },
        remove: async (paths: string[]) => {
          removed.push(paths);
          return { data: null, error: null };
        },
      }),
    };
    return { supabase: { from: db.from, storage } as any, calls: db.calls, uploads, removed };
  }
  const msg = { groupId: G1, senderId: ANN, senderName: "Ann", recipientId: COACH, audio, mimeType: "audio/webm;codecs=opus", seconds: 30, fileId: FILE };

  it("puts the file in the sender's folder, then sends the message that names it, and the push says who sent a voice note", async () => {
    const row = { id: "m1", sender_id: ANN, body: "Voice note", created_at: "now", voice_path: `${ANN}/${G1}/${FILE}.webm`, voice_seconds: 30 };
    const c = client({ data: row, error: null });
    expect(await sendVoiceNote(c.supabase, msg)).toEqual(row);
    expect(c.uploads).toEqual([{ path: `${ANN}/${G1}/${FILE}.webm`, type: "audio/webm" }]);
    expect(c.calls[0].payload).toEqual({ group_id: G1, sender_id: ANN, recipient_id: COACH, body: "Voice note", voice_path: `${ANN}/${G1}/${FILE}.webm`, voice_seconds: 30 });
    expect(pushes).toEqual([[COACH, "Ann sent a voice note", "Open Messages to listen.", `/groups/${G1}/messages/${ANN}`]]);
    expect(voiceNotePushTitle("  ")).toBe("Someone sent a voice note");
  });
  it("a refused message takes its file back out, and nobody is told", async () => {
    const c = client({ data: null, error: { message: "row-level security" } });
    expect(await sendVoiceNote(c.supabase, msg)).toBeNull();
    expect(c.removed).toEqual([[`${ANN}/${G1}/${FILE}.webm`]]);
    expect(pushes).toEqual([]);
  });
  it("a failed upload sends no message; too long or empty sends nothing at all", async () => {
    const c = client({ data: {}, error: null }, { message: "refused" });
    expect(await sendVoiceNote(c.supabase, msg)).toBeNull();
    expect(c.calls).toHaveLength(0);
    const d = client({ data: {}, error: null });
    expect(await sendVoiceNote(d.supabase, { ...msg, seconds: 121 })).toBeNull();
    expect(await sendVoiceNote(d.supabase, { ...msg, audio: new Blob([]) })).toBeNull();
    expect(d.uploads).toHaveLength(0);
  });
});

describe("R7 voice notes: Download my data and deleting an account", () => {
  it("Download my data lists the voice notes the person sent, as links", async () => {
    expect(SOURCES).toContainEqual({ kind: "voice_note", bucket: "voice-notes", table: "direct_messages", column: "voice_path", owner: "sender_id" });
    const signedFor: string[] = [];
    const db = fakeDb((q) => (q.table === "direct_messages" ? { data: [{ voice_path: `${ANN}/${G1}/${FILE}.webm` }], error: null } : { data: [], error: null }));
    const supabase = {
      from: db.from,
      storage: { from: (b: string) => ({ createSignedUrls: async (paths: string[]) => (signedFor.push(b), { data: paths.map((p) => ({ path: p, signedUrl: `https://x/${p}` })), error: null }) }) },
    };
    const out = await collectExportFiles(supabase as any, ANN);
    expect(out.files).toEqual([{ kind: "voice_note", path: `${ANN}/${G1}/${FILE}.webm`, downloadUrl: `https://x/${ANN}/${G1}/${FILE}.webm` }]);
    expect(db.calls.find((q) => q.table === "direct_messages")?.filters).toEqual({ sender_id: ANN });
    expect(out.notIncluded).toBe(0);
  });
  it("before the database update there are simply no voice notes (nothing is counted as missing)", async () => {
    const db = fakeDb((q) => (q.table === "direct_messages" ? { data: null, error: { code: "42703", message: "column does not exist" } } : { data: [], error: null }));
    const out = await collectExportFiles({ from: db.from, storage: { from: () => ({ createSignedUrls: async () => ({ data: [], error: null }) }) } } as any, ANN);
    expect(out.notIncluded).toBe(0);
  });
  it("deleting an account removes the voice notes they sent and the ones sent to them", () => {
    expect(STORAGE_FILES).toContainEqual({ bucket: "voice-notes", table: "direct_messages", column: "voice_path", owner: "sender_id" });
    expect(STORAGE_FILES).toContainEqual({ bucket: "voice-notes", table: "direct_messages", column: "voice_path", owner: "recipient_id" });
    expect(pathBelongsToPerson("voice-notes", `${COACH}/${G1}/${FILE}.webm`, ANN)).toBe(true);
    expect(pathBelongsToPerson("voice-notes", "stray.webm", ANN)).toBe(false);
    expect(read("lib/account-deletion.ts")).toContain('if (error && error.code === "42703") continue;');
  });
});

describe("$5 a failed card payment", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  it("shows only while Stripe says the subscription is past due; a next try in the past is not a date", () => {
    expect(failedPayment({ status: "active", latest: { created_at: "2026-11-18T10:00:00Z" } }, now)).toBeNull();
    expect(failedPayment({ status: "canceled" }, now)).toBeNull();
    expect(failedPayment({ status: "past_due", latest: { created_at: "2026-11-18T10:00:00Z", next_attempt_at: "2026-11-23T10:00:00Z" } }, now)).toEqual({ failedAt: "2026-11-18T10:00:00Z", nextTryAt: "2026-11-23T10:00:00Z" });
    expect(failedPayment({ status: "past_due", latest: { created_at: "2026-11-18T10:00:00Z", next_attempt_at: "2026-11-19T10:00:00Z" } }, now)?.nextTryAt).toBeNull();
    expect(failedPayment({ status: "past_due", latest: null }, now)).toEqual({ failedAt: null, nextTryAt: null });
  });
  it("tells the client plainly, and the coach what Stripe does next without inventing a schedule", () => {
    const withDate = { failedAt: "2026-11-18T10:00:00Z", nextTryAt: "2026-11-23T10:00:00Z" };
    expect(clientFailedPaymentLine(withDate, "America/New_York")).toBe("Your last card payment didn't go through. Please update your card before Stripe tries it again on Mon, Nov 23. Nothing else changes while it's sorted out.");
    expect(coachFailedPaymentLine(withDate, "America/New_York")).toContain("Stripe will try the card again on Mon, Nov 23.");
    const noDate = coachFailedPaymentLine({ failedAt: null, nextTryAt: null }, "UTC");
    expect(noDate).toContain("on the retry schedule in your Stripe settings");
    expect(noDate).not.toMatch(/\d+ (days?|hours?)/);
    expect(noDate).toContain("Nothing changes here on its own");
  });
  it("reads the subscription and the newest failed try, under the viewer's own sign-in", async () => {
    const db = fakeDb((q) => {
      if (q.table === "membership_subscriptions") return { data: { status: "past_due", stripe_subscription_id: "sub_1" }, error: null };
      if (q.table === "payment_events") return { data: [{ created_at: "2026-11-18T10:00:00Z", next_attempt_at: "2026-11-23T10:00:00Z" }], error: null };
      return { data: null, error: null };
    });
    expect(await loadFailedPayment(db, { athleteId: ANN, groupId: G1 }, now)).toEqual({ failedAt: "2026-11-18T10:00:00Z", nextTryAt: "2026-11-23T10:00:00Z" });
    expect(db.calls[1].filters).toEqual({ kind: "payment_failed", athlete_id: ANN, subscription_id: "sub_1" });
  });
  it("before the database update the read is made without the next-try column", async () => {
    let tries = 0;
    const db = fakeDb((q) => {
      if (q.table === "membership_subscriptions") return { data: { status: "past_due", stripe_subscription_id: "sub_1" }, error: null };
      tries++;
      return q.cols.includes("next_attempt_at") ? { data: null, error: { code: "42703" } } : { data: [{ created_at: "2026-11-18T10:00:00Z" }], error: null };
    });
    expect(await loadFailedPayment(db, { athleteId: ANN, groupId: G1 }, now)).toEqual({ failedAt: "2026-11-18T10:00:00Z", nextTryAt: null });
    expect(tries).toBe(2);
  });
  it("the webhook keeps Stripe's own next-try date, best effort (a missing column never fails the event)", async () => {
    const src = read("lib/payment-events.ts");
    expect(src).toContain("next_payment_attempt");
    expect(src).toContain('if (input.kind === "payment_failed" && input.nextAttemptAt !== undefined) await recordNextAttempt(db, recorded.id, input.nextAttemptAt);');
    const db = fakeDb(() => ({ data: null, error: { code: "42703", message: "no column" } }));
    await expect(recordNextAttempt(db, "e1", "2026-11-23T10:00:00.000Z")).resolves.toBeUndefined();
    expect(db.calls[0]).toMatchObject({ table: "payment_events", op: "update", payload: { next_attempt_at: "2026-11-23T10:00:00.000Z" }, filters: { id: "e1" } });
    const boom = { from: () => {
      throw new Error("down");
    } };
    await expect(recordNextAttempt(boom, "e1", null)).resolves.toBeUndefined();
  });
  it("the client sees it on Home with Update my card (the existing billing page); the coach sees Payment failed on the client; nothing blocks or charges", () => {
    const notice = read("components/athlete/payment-failed-notice.tsx");
    expect(notice).toContain('label="Update my card"');
    expect(read("components/athlete/manage-billing-link.tsx")).toContain('fetch("/api/stripe/portal"');
    expect(read("app/(coach)/groups/[groupId]/page.tsx")).toContain("<PaymentFailedNotice groupId={params.groupId} athleteId={athleteId} />");
    const facts = read("components/coach/client-billing-facts.tsx");
    expect(facts).toContain("Payment failed");
    expect(read("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx")).toContain("<ClientBillingFacts groupId={params.groupId} athleteId={params.athleteId} timeZone={displayZone} />");
    for (const f of ["components/athlete/payment-failed-notice.tsx", "components/coach/client-billing-facts.tsx", "lib/payment-failed.ts"]) expect(read(f)).not.toMatch(/\.(insert|update|delete|rpc)\(/);
  });
});

describe("$4 and $5 and $6: the help lines", () => {
  it("Help > Business explains failed cards, disputes and pausing, in plain words", () => {
    const business = HELP_BY_SLUG.get("business")!;
    const heads = business.sections.map((s) => s.heading);
    expect(heads).toEqual(expect.arrayContaining(["A failed card payment", "A disputed payment", "Pausing a client"]));
    expect(business.sections.find((s) => s.heading === "A failed card payment")!.body).toEqual([FAILED_CARD_HELP]);
    expect(business.sections.find((s) => s.heading === "Pausing a client")!.body).toEqual(PAUSE_CLIENT_HELP);
    expect(business.sections.find((s) => s.heading === "A disputed payment")!.body).toEqual([DISPUTE_HELP]);
  });
  it("the pause line describes only the tools there are: the weekly schedule's Pause and Stripe's own subscription", () => {
    expect(PAUSE_CLIENT_LINE).toContain("tap Pause on their weekly schedule");
    expect(read("components/coach/client-series-panel.tsx")).toContain('{ action: "pause" }');
    expect(PAUSE_CLIENT_LINE).toContain("Stripe dashboard");
    expect(read("components/coach/client-billing-facts.tsx")).toContain("{PAUSE_CLIENT_LINE}");
  });
  it("the dispute line says how to upload it in Stripe, and that nothing is sent for them", () => {
    expect(DISPUTE_UPLOAD_LINE).toContain("upload");
    expect(DISPUTE_UPLOAD_LINE).toContain("doesn't send anything to Stripe");
    expect(read("app/print/dispute-evidence/[purchaseId]/page.tsx")).toContain("{DISPUTE_UPLOAD_LINE}");
  });
});

describe("$6 evidence for a dispute", () => {
  const PAY = "dddddddd-0000-4000-8000-000000000001";
  const payRow = { id: PAY, created_at: "2026-10-01T15:00:00Z", amount_cents: 40000, credits_purchased: 8, coach_package_id: "pkg1", stripe_checkout_session_id: "cs_1", athlete_id: ANN, group_id: G1 };
  function db(role: string | null) {
    return fakeDb((q, single) => {
      if (q.table === "credit_purchases" && single) return { data: payRow, error: null };
      if (q.table === "credit_purchases") return { data: [{ created_at: "2026-11-01T15:00:00Z" }], error: null };
      if (q.table === "group_memberships") return { data: role ? { role } : null, error: null };
      if (q.table === "profiles") return { data: [{ id: ANN, full_name: "Ann Lee" }, { id: COACH, full_name: "Ron" }], error: null };
      if (q.table === "groups") return { data: { name: "Ann Lee" }, error: null };
      if (q.table === "client_intake") return { data: { waiver_signed_name: "Ann Lee", waiver_accepted: true, completed_at: "2026-09-30T12:00:00Z" }, error: null };
      if (q.table === "legal_acceptances") return { data: [{ version: "2026-09", accepted_at: "2026-09-30T12:00:00Z" }], error: null };
      if (q.table === "bookings")
        return {
          data: [
            { start_at: "2026-10-03T14:00:00Z", end_at: "2026-10-03T15:00:00Z", created_at: "2026-10-01T16:00:00Z", status: "confirmed", no_show: false, late_cancel: false, attended_at: "2026-10-03T15:00:00Z" },
            { start_at: "2026-10-10T14:00:00Z", end_at: "2026-10-10T15:00:00Z", created_at: "2026-10-01T16:00:00Z", status: "confirmed", no_show: true, late_cancel: false, attended_at: null },
          ],
          error: null,
        };
      if (q.table === "direct_messages") return { data: [{ sender_id: ANN, body: "See you Friday", created_at: "2026-10-02T10:00:00Z", voice_seconds: null }, { sender_id: COACH, body: "Voice note", created_at: "2026-10-02T11:00:00Z", voice_seconds: 45 }], error: null };
      return { data: null, error: null };
    });
  }
  const server = () =>
    fakeDb((q) => {
      if (q.table === "coach_packages") return { data: { name: "8 sessions", billing_type: "one_time", kind: "sessions", sessions_granted: 8, sessions_per_week: 2, rate_cents: 40000, price_cents: null, coach_id: COACH }, error: null };
      if (q.table === "group_memberships") return { data: { role: "coach" }, error: null };
      return { data: null, error: null };
    });

  it("only a coach of the space the payment was made in", async () => {
    expect(await loadDisputeEvidence(db("athlete"), server(), { purchaseId: PAY, viewerId: COACH })).toMatchObject({ ok: false, status: 403 });
    expect(await loadDisputeEvidence(db(null), server(), { purchaseId: PAY, viewerId: COACH })).toMatchObject({ ok: false, status: 403 });
  });
  it("gathers the payment, package, waiver, sessions and messages of this client only, from the payment to the next one", async () => {
    const d = db("coach");
    const s = server();
    const loaded = await loadDisputeEvidence(d, s, { purchaseId: PAY, viewerId: COACH, now: new Date("2026-11-20T00:00:00Z") });
    if (!loaded.ok) throw new Error(loaded.error);
    const e = loaded.evidence;
    expect(e.payment).toMatchObject({ amountCents: 40000, sessions: 8, athleteId: ANN });
    expect(e.windowEnd).toBe("2026-11-01T15:00:00Z");
    expect(e.windowEndIsNextPayment).toBe(true);
    expect(e.pkg).toMatchObject({ name: "8 sessions", priceCents: 40000 });
    expect(e.waiver).toEqual({ signedName: "Ann Lee", accepted: true, completedAt: "2026-09-30T12:00:00Z", versions: [{ version: "2026-09", acceptedAt: "2026-09-30T12:00:00Z" }] });
    expect(e.sessions.map((x) => sessionOutcome(x))).toEqual(["Attended", "No-show"]);
    expect(e.messages).toEqual([
      { at: "2026-10-02T10:00:00Z", from: "client", text: "See you Friday" },
      { at: "2026-10-02T11:00:00Z", from: "coach", text: "Voice note (0:45)" },
    ]);
    expect(e.incomplete).toBe(false);
    // every read about the client names this client; the messages are this coach's own with them
    for (const q of d.calls.filter((c) => ["bookings", "client_intake"].includes(c.table))) expect(q.filters.athlete_id).toBe(ANN);
    expect(d.calls.find((c) => c.table === "legal_acceptances")!.filters).toMatchObject({ profile_id: ANN, document: "waiver" });
    expect(d.calls.find((c) => c.table === "direct_messages")!.filters.or).toBe(`and(sender_id.eq.${COACH},recipient_id.eq.${ANN}),and(sender_id.eq.${ANN},recipient_id.eq.${COACH})`);
    // the server's key reads only the package this payment names (and checks it is a package of a coach of the space)
    expect(s.calls.map((c) => c.table)).toEqual(["coach_packages", "group_memberships"]);
    expect(s.calls[0].filters).toEqual({ id: "pkg1" });
  });
  it("the download is spreadsheets of the same facts, with how to upload them", async () => {
    const loaded = await loadDisputeEvidence(db("coach"), server(), { purchaseId: PAY, viewerId: COACH });
    const e = (loaded as { evidence: DisputeEvidence }).evidence;
    const files = evidenceFiles(e, "America/New_York", DISPUTE_UPLOAD_LINE);
    expect(files.map((f) => f.name)).toEqual(["payment.csv", "package.csv", "waiver.csv", "sessions.csv", "messages.csv", "README.txt"]);
    expect(files[0].text).toContain("$400.00");
    expect(files[1].text).toContain("The app does not keep a copy of the checkout page.");
    expect(files[2].text).toContain("2026-09");
    expect(files[3].text).toContain("No-show");
    expect(files[4].text).toContain("See you Friday");
    expect(files[5].text).toContain(DISPUTE_UPLOAD_LINE);
    expect(sessionOutcome({ startAt: "2099-01-01T00:00:00Z", endAt: null, bookedAt: "x", status: "confirmed", noShow: false, lateCancel: false, attendedAt: null })).toBe("Booked, still to come");
    expect(sessionOutcome({ startAt: "2020-01-01T00:00:00Z", endAt: null, bookedAt: "x", status: "cancelled", noShow: false, lateCancel: true, attendedAt: null })).toBe("Cancelled late");
  });
  it("the page prints, the download is read only, and the client's payments link to it", () => {
    const page = read("app/print/dispute-evidence/[purchaseId]/page.tsx");
    expect(page).toContain("@media print");
    expect(page).toContain("/api/coach/dispute-evidence?purchaseId=");
    const route = read("app/api/coach/dispute-evidence/route.ts");
    expect(route).not.toMatch(/export async function (POST|PUT|PATCH|DELETE)/);
    expect(read("components/coach/client-billing-facts.tsx")).toContain("/print/dispute-evidence/${p.id}");
  });
});

describe("$3 saved pay periods", () => {
  const C2 = "33333333-3333-4333-8333-333333333333";
  const activity = {
    rows: [
      { coachId: COACH, name: "Ron", role: "owner", clients: 5, sessionsDelivered: 4, noShows: 1, lateCancels: 0, quietClients: 0, lowBalanceClients: 1 },
      { coachId: C2, name: "Sam", role: "coach", clients: 2, sessionsDelivered: 3, noShows: 0, lateCancels: 1, quietClients: 1, lowBalanceClients: 0 },
    ],
    sessionLines: [{ bookingId: "b1", coachId: COACH, coachName: "Ron", startAt: "2026-11-03T15:00:00Z", clientName: "Ann", sessionType: "in_person" }],
    creditsSold: 12,
  };
  const period = { fromDay: "2026-11-01", toDay: "2026-11-15", timeZone: "America/New_York" };

  it("keeps each coach's numbers, the rate typed and the pay line exactly as the page works them out", () => {
    const snap = buildPayrollSnapshot(activity, period, cleanRates({ [COACH]: 4500, [C2]: "3000", "not-a-coach": 100, [C2 + "x"]: 1 }));
    expect(snap.rows.map((r) => [r.name, r.sessionsDelivered, r.rateCents, r.estimateCents])).toEqual([
      ["Ron", 4, 4500, 18000],
      ["Sam", 3, 3000, 9000],
    ]);
    expect(snap.totals).toEqual({ sessionsDelivered: 7, estimateCents: 27000 });
    expect(snap.sessionLines[0].estimateCents).toBe(4500);
    expect(snap.period).toEqual(period);
    expect(cleanRates({ [COACH]: -5, [C2]: 1.5 })).toEqual({});
    expect(cleanNote("  paid by check  ")).toBe("paid by check");
    expect(cleanNote("x".repeat(2000))?.length).toBe(1000);
    expect(cleanNote(7)).toBeNull();
  });
  it("downloads as a spreadsheet of the pay lines and the sessions behind them", () => {
    const csv = payrollCsv({ created_at: "2026-11-16T12:00:00Z", note: "First half", snapshot: buildPayrollSnapshot(activity, period, { [COACH]: 4500 }) });
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("2026-11-01,2026-11-15,America/New_York,2026-11-16,First half");
    expect(csv).toContain("Ron,owner,5,4,1,0,4500,18000");
    expect(csv).toContain("Everyone,,,7,,,,18000");
    expect(csv).toContain("Ron,2026-11-03,America/New_York,Ann,in_person,b1,4500");
  });
  it("only the owner and admins save; the numbers are worked out again on the server and a period not read in full is not saved", () => {
    const route = read("app/api/coach/payroll-reports/route.ts");
    expect(route).toContain('orgRow?.role !== "owner" && orgRow?.role !== "admin"');
    expect(route.indexOf("loadCoachActivity(supabase")).toBeLessThan(route.indexOf("createServiceRoleClient()"));
    expect(route).toContain("if (activity.failed || activity.truncated)");
    expect(isWriteRequest("POST", "/api/coach/payroll-reports", "https://app.example", undefined)).toBe(true);
  });
  it("a saved report is read only: no route changes or deletes one, and the database refuses any change", () => {
    for (const f of ["app/api/coach/payroll-reports/route.ts", "app/api/coach/payroll-reports/[reportId]/csv/route.ts"]) expect(read(f)).not.toMatch(/export async function (PUT|PATCH|DELETE)/);
    const sql = read("supabase/migrations/0464_voice_notes_payroll_reports.sql");
    expect(sql).toContain("raise exception 'A saved payroll report cannot be changed.'");
    expect(sql).toContain("create policy \"payroll_reports_read_owner_admin\" on public.payroll_reports for select to authenticated\n  using (public.is_org_owner_or_admin(organization_id));");
    expect(read("app/(coach)/groups/[groupId]/team-activity/page.tsx")).toContain("<SavedPayPeriods");
    expect(read("components/org/coach-activity-table.tsx")).toContain("Save this pay period");
  });
});

describe("step 220: the paste", () => {
  it("holds the migration byte for byte, is ASCII, and ends in one check row", () => {
    const paste = read("supabase/apply/apply-step220-0464.sql");
    const mig = read("supabase/migrations/0464_voice_notes_payroll_reports.sql").trim();
    expect(paste).toContain(mig);
    expect(/[^\x00-\x7f]/.test(paste + read("supabase/apply/undo-step220-0464.sql"))).toBe(false);
    expect(paste.startsWith("-- PASTE: step 220")).toBe(true);
    const tail = paste.slice(paste.indexOf("-- check: one row"));
    expect(tail.match(/^select$/m)?.length).toBe(1);
    expect(tail.trim().endsWith("as payroll_never_changes;")).toBe(true);
  });
});
