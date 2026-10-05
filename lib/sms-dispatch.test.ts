import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consentScopeFor, dispatchSms } from "@/lib/sms-dispatch";

type ConsentRow = { phone_e164: string | null; allowed: boolean; reason: string | null };

// A just-enough Supabase fake: rpc() for the consent check, and the three
// tables dispatchSms reads/writes afterwards.
function fakeSupabase(opts: {
  consent?: ConsentRow | null;
  rpcError?: boolean;
  smsEnabled?: boolean;
  logInsertError?: boolean;
}) {
  const calls = { rpc: [] as unknown[], logInserts: [] as unknown[] };
  const client = {
    rpc: vi.fn(async (name: string, args: unknown) => {
      calls.rpc.push({ name, args });
      if (opts.rpcError) return { data: null, error: { message: "boom" } };
      return { data: opts.consent ? [opts.consent] : [], error: null };
    }),
    from: vi.fn((table: string) => {
      if (table === "coach_sms_config") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { sms_enabled: opts.smsEnabled ?? true, quiet_hours_start: null, quiet_hours_end: null },
              }),
            }),
          }),
        };
      }
      if (table === "profiles") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { timezone: "UTC" } }) }) }) };
      }
      if (table === "sms_log") {
        return {
          insert: async (row: unknown) => {
            calls.logInserts.push(row);
            return { error: opts.logInsertError ? { message: "dup" } : null };
          },
        };
      }
      throw new Error("unexpected table " + table);
    }),
  };
  return { client: client as never, calls };
}

const base = {
  coachId: "coach-1",
  messageType: "booking_confirmation" as const,
  referenceId: "ref-1",
  body: "hi",
};

describe("consentScopeFor", () => {
  it("maps each message type to the scope the client consented to", () => {
    expect(consentScopeFor("booking_confirmation")).toBe("appointments");
    expect(consentScopeFor("session_reminder")).toBe("appointments");
    expect(consentScopeFor("attendance_nudge")).toBe("announcements");
    expect(consentScopeFor("low_credit_alert")).toBe("coach_only");
  });
});

describe("dispatchSms consent gate", () => {
  const fetchMock = vi.fn(async () => ({ ok: true }));

  beforeEach(() => {
    process.env.TWILIO_ACCOUNT_SID = "ACtest";
    process.env.TWILIO_AUTH_TOKEN = "token";
    process.env.TWILIO_FROM_NUMBER = "+15550000000";
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_FROM_NUMBER;
    vi.unstubAllGlobals();
  });

  it("does nothing when Twilio isn't configured", async () => {
    delete process.env.TWILIO_AUTH_TOKEN;
    const { client, calls } = fakeSupabase({});
    const r = await dispatchSms(client, { ...base, athleteId: "a1" });
    expect(r).toEqual({ sent: false, reason: "twilio_not_configured" });
    expect(calls.rpc).toHaveLength(0);
  });

  it("fails closed with no athlete id (never even asks the database)", async () => {
    const { client, calls } = fakeSupabase({});
    const r = await dispatchSms(client, base);
    expect(r).toEqual({ sent: false, reason: "no_consent" });
    expect(calls.rpc).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never texts an athlete with no consent row", async () => {
    const { client } = fakeSupabase({ consent: { phone_e164: null, allowed: false, reason: "no_consent" } });
    const r = await dispatchSms(client, { ...base, athleteId: "a1" });
    expect(r).toEqual({ sent: false, reason: "no_consent" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when the consent check itself errors", async () => {
    const { client } = fakeSupabase({ rpcError: true });
    const r = await dispatchSms(client, { ...base, athleteId: "a1" });
    expect(r).toEqual({ sent: false, reason: "no_consent" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces STOP and under-13 reasons without texting", async () => {
    const stopped = fakeSupabase({ consent: { phone_e164: "+15551230000", allowed: false, reason: "opted_out" } });
    expect(await dispatchSms(stopped.client, { ...base, athleteId: "a1" })).toEqual({ sent: false, reason: "opted_out" });
    const minor = fakeSupabase({
      consent: { phone_e164: "+15551230000", allowed: false, reason: "minor_no_guardian_consent" },
    });
    expect(await dispatchSms(minor.client, { ...base, athleteId: "a1" })).toEqual({
      sent: false,
      reason: "minor_no_guardian_consent",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks for the scope that matches the message type", async () => {
    const { client, calls } = fakeSupabase({ consent: { phone_e164: null, allowed: false, reason: "no_consent" } });
    await dispatchSms(client, { ...base, messageType: "attendance_nudge", athleteId: "a1" });
    expect(calls.rpc[0]).toEqual({
      name: "sms_consent_for_dispatch",
      args: { p_athlete_id: "a1", p_scope: "announcements" },
    });
  });

  it("texts the number the athlete consented to, ignoring any other phone", async () => {
    const { client, calls } = fakeSupabase({ consent: { phone_e164: "+15551230000", allowed: true, reason: null } });
    const r = await dispatchSms(client, { ...base, athleteId: "a1", recipientPhone: "+19998887777" });
    expect(r.sent).toBe(true);
    expect((calls.logInserts[0] as { recipient_phone: string }).recipient_phone).toBe("+15551230000");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still requires the coach's own sms switch after consent passes", async () => {
    const { client } = fakeSupabase({
      consent: { phone_e164: "+15551230000", allowed: true, reason: null },
      smsEnabled: false,
    });
    expect(await dispatchSms(client, { ...base, athleteId: "a1" })).toEqual({ sent: false, reason: "not_opted_in" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("coach-only alerts need no client consent and go to the coach's phone", async () => {
    const { client, calls } = fakeSupabase({});
    const r = await dispatchSms(client, {
      ...base,
      messageType: "low_credit_alert",
      recipientPhone: "(555) 123-4567",
    });
    expect(r.sent).toBe(true);
    expect(calls.rpc).toHaveLength(0);
    expect((calls.logInserts[0] as { recipient_phone: string }).recipient_phone).toBe("+15551234567");
  });

  it("does not text twice for the same reference id", async () => {
    const { client } = fakeSupabase({
      consent: { phone_e164: "+15551230000", allowed: true, reason: null },
      logInsertError: true,
    });
    expect(await dispatchSms(client, { ...base, athleteId: "a1" })).toEqual({ sent: false, reason: "already_sent" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
