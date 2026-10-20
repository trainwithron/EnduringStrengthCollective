import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { confirmationEmail, emailClientNotice, reminderEmail, shouldReleaseClaim, wasDelivered } from "@/lib/client-notice-email";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

describe("the exact words", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = "https://spotlightcoaching.app";
  });
  it("reminder", () => {
    const m = reminderEmail({ coachName: "Ron Arnold", time: "3:00 PM", groupId: "g1" });
    expect(m.subject).toBe("Your session today at 3:00 PM");
    expect(m.text).toContain("Your session with Ron starts at 3:00 PM.");
    expect(m.text).toContain("Turn on alerts in Settings > Notifications to get these on your phone.");
    expect(m.text.endsWith("\n")).toBe(true);
  });
  it("confirmation", () => {
    const m = confirmationEmail({ coachName: "Ron Arnold", when: "Mon, Oct 19, 3:00 PM", groupId: "g1" });
    expect(m.subject).toBe("Session confirmed: Mon, Oct 19, 3:00 PM");
    expect(m.text).toContain("You're booked with Ron for Mon, Oct 19, 3:00 PM.");
    expect(m.text).toContain("Turn on alerts in Settings > Notifications to get these on your phone.");
  });
  it("without a known coach it says 'your coach'", () => {
    expect(reminderEmail({ coachName: null, time: "9:00 AM", groupId: "g" }).text).toContain("Your session with your coach starts at 9:00 AM.");
  });
});

describe("what counts as delivered", () => {
  it("a phone alert, a text or an accepted email; nothing else", () => {
    expect(wasDelivered({ pushCount: 1, smsSent: false, email: null })).toBe(true);
    expect(wasDelivered({ pushCount: 0, smsSent: true, email: null })).toBe(true);
    expect(wasDelivered({ pushCount: 0, smsSent: false, email: "sent" })).toBe(true);
    for (const e of ["quiet", "no_address", "not_configured", "failed", null] as const) expect(wasDelivered({ pushCount: 0, smsSent: false, email: e }), String(e)).toBe(false);
  });
  it("the claim is given back only when nothing delivered and the session has not started", () => {
    const now = new Date("2026-10-19T14:00:00Z");
    expect(shouldReleaseClaim(false, "2026-10-19T14:40:00Z", now)).toBe(true);
    expect(shouldReleaseClaim(true, "2026-10-19T14:40:00Z", now)).toBe(false);
    expect(shouldReleaseClaim(false, "2026-10-19T13:59:00Z", now)).toBe(false);
  });
});

describe("emailing the client", () => {
  const fetchMock = vi.fn();
  function db(opts: { email?: string | null; quiet?: boolean }) {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { quiet_hours_start: opts.quiet ? 0 : null, quiet_hours_end: opts.quiet ? 23 : null, generic_push_text: false, timezone: "America/Los_Angeles" }, error: null }),
          }),
        }),
      }),
      auth: { admin: { getUserById: async () => ({ data: { user: opts.email === undefined ? null : { email: opts.email } } }) } },
    } as any;
  }
  beforeEach(() => {
    process.env.BREVO_API_KEY = "k";
    process.env.BREVO_FROM_EMAIL = "noreply@example.com";
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 201, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.BREVO_API_KEY;
    delete process.env.BREVO_FROM_EMAIL;
  });
  it("sends to a real address", async () => {
    expect(await emailClientNotice(db({ email: "client@example.com" }), "p1", "S", "T")).toBe("sent");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("never to a placeholder address (a client set up before they claimed the account) or none", async () => {
    expect(await emailClientNotice(db({ email: "client-abc@pending.invalid" }), "p1", "S", "T")).toBe("no_address");
    expect(await emailClientNotice(db({ email: null }), "p1", "S", "T")).toBe("no_address");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("never during the person's quiet hours (dropped, not queued)", async () => {
    // quiet 0:00-23:00 in Los Angeles: pin the clock to noon there, so the test does not fail when it runs in the 11 PM hour
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-19T19:00:00Z"));
    try {
      expect(await emailClientNotice(db({ email: "client@example.com", quiet: true }), "p1", "S", "T")).toBe("quiet");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it("nothing is sent when email is not configured", async () => {
    delete process.env.BREVO_API_KEY;
    expect(await emailClientNotice(db({ email: "client@example.com" }), "p1", "S", "T")).toBe("not_configured");
  });
  it("a refused send is reported as failed", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, text: async () => "" });
    expect(await emailClientNotice(db({ email: "client@example.com" }), "p1", "S", "T")).toBe("failed");
  });
});

describe("the three call sites", () => {
  it("the reminder tries push and text first, emails only if neither reached them, and gives the claim back when nothing delivered", () => {
    const r = read("app/api/cron/session-reminder/route.ts");
    expect(r).toContain("if (count === 0 && !smsResult.sent) {");
    expect(r).toContain("shouldReleaseClaim(delivered, booking.start_at, now)");
    expect(r).toContain('.update({ reminder_sent_at: null }).eq("id", booking.id).eq("reminder_sent_at", now.toISOString())');
    expect(r.indexOf("dispatchSms(")).toBeLessThan(r.indexOf("emailClientNotice("));
  });
  it("the confirmation is a server route: only the client or a coach of the group, for a booking that exists, once per booking, push first then email", () => {
    const route = read("app/api/bookings/confirmed-notice/route.ts");
    expect(route).toContain("getCallerGroupRole(supabase, user.id, groupId)");
    expect(route).toContain('role === "athlete" && user.id !== athleteId');
    expect(route).toContain('.eq("status", "confirmed")');
    expect(route).toContain('rateLimitResponse("confirmed-notice"');
    expect(route.indexOf("sendPushToProfile(")).toBeLessThan(route.indexOf("emailClientNotice("));
    expect(read("lib/notify-booking-confirmed.ts")).toContain('fetch("/api/bookings/confirmed-notice"');
  });
  it("'Good job' stays phone-only: no email there", () => {
    expect(read("app/api/bookings/completed-notice/route.ts")).not.toContain("emailClientNotice");
  });
});
