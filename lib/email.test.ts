import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isEmailConfigured, sendEmail } from "@/lib/email";

const KEYS = ["BREVO_API_KEY", "BREVO_FROM_EMAIL", "BREVO_FROM_NAME"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

describe("outgoing email (Brevo)", () => {
  it("is not configured without both the key and the sender address, and then sends nothing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(isEmailConfigured()).toBe(false);
    process.env.BREVO_API_KEY = "k";
    expect(isEmailConfigured()).toBe(false);
    expect(await sendEmail("a@b.com", "s", "t")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    process.env.BREVO_FROM_EMAIL = "noreply@x.com";
    expect(isEmailConfigured()).toBe(true);
  });

  it("posts a plain-text message to Brevo's transactional endpoint with the api-key header", async () => {
    process.env.BREVO_API_KEY = "secret-key";
    process.env.BREVO_FROM_EMAIL = "noreply@x.com";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    expect(await sendEmail("client@example.com", "Your sign-in link", "Tap here")).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(init.method).toBe("POST");
    expect(init.headers["api-key"]).toBe("secret-key");
    expect(init.headers.Authorization).toBeUndefined();
    const body = JSON.parse(init.body);
    expect(body).toEqual({ sender: { name: "Spotlight Coaching", email: "noreply@x.com" }, to: [{ email: "client@example.com" }], subject: "Your sign-in link", textContent: "Tap here" });
  });

  it("uses the optional sender name when set", async () => {
    process.env.BREVO_API_KEY = "k";
    process.env.BREVO_FROM_EMAIL = "noreply@x.com";
    process.env.BREVO_FROM_NAME = "Coach Ron";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    await sendEmail("a@b.com", "s", "t");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).sender.name).toBe("Coach Ron");
  });

  it("logs one line with Brevo's status, code and message when it refuses, and never the key, the recipient or the text", async () => {
    process.env.BREVO_API_KEY = "super-secret-key";
    process.env.BREVO_FROM_EMAIL = "noreply@x.com";
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const cases: [number, string, string][] = [
      [401, JSON.stringify({ code: "unauthorized", message: "Key not found" }), "HTTP 401 unauthorized: Key not found"],
      [403, JSON.stringify({ code: "permission_denied", message: "Your account is not activated" }), "HTTP 403 permission_denied: Your account is not activated"],
      [400, JSON.stringify({ code: "invalid_parameter", message: "sender is not valid" }), "HTTP 400 invalid_parameter: sender is not valid"],
    ];
    for (const [status, body, expected] of cases) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status, text: async () => body }));
      expect(await sendEmail("private.person@example.com", "Secret subject", "Secret body text")).toBe(false);
      const line = String(errors.mock.calls[errors.mock.calls.length - 1][0]);
      expect(line).toContain(expected);
      expect(line).not.toContain("super-secret-key");
      expect(line).not.toContain("private.person@example.com");
      expect(line).not.toContain("Secret body text");
      expect(line).not.toContain("Secret subject");
    }
    // Brevo's own message can echo a rejected address (or even the key): both are blanked out of the log line
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => JSON.stringify({ code: "invalid_parameter", message: "Email private.person@example.com is blacklisted; key super-secret-key" }) }));
    expect(await sendEmail("private.person@example.com", "s", "t")).toBe(false);
    const echoed = String(errors.mock.calls[errors.mock.calls.length - 1][0]);
    expect(echoed).toContain("HTTP 400 invalid_parameter: Email [email] is blacklisted; key [key]");
    expect(echoed).not.toContain("private.person@example.com");
    expect(echoed).not.toContain("super-secret-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 502, text: async () => "upstream error for <to=a.b@c.org>" }));
    await sendEmail("a@b.com", "s", "t");
    expect(String(errors.mock.calls[errors.mock.calls.length - 1][0])).not.toContain("a.b@c.org");
    // a body that is not JSON is still reported, cut short
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 502, text: async () => "Bad gateway " + "x".repeat(1000) }));
    expect(await sendEmail("a@b.com", "s", "t")).toBe(false);
    const long = String(errors.mock.calls[errors.mock.calls.length - 1][0]);
    expect(long).toContain("HTTP 502");
    expect(long.length).toBeLessThanOrEqual(300);
    // a thrown request logs only the kind of failure
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connect to api.brevo.com for private.person@example.com failed")));
    expect(await sendEmail("private.person@example.com", "s", "t")).toBe(false);
    const thrown = String(errors.mock.calls[errors.mock.calls.length - 1][0]);
    expect(thrown).toContain("Brevo request failed: Error");
    expect(thrown).not.toContain("private.person@example.com");
    errors.mockRestore();
  });

  it("reports false when Brevo refuses or the network fails, and never throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.BREVO_API_KEY = "k";
    process.env.BREVO_FROM_EMAIL = "noreply@x.com";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "" }));
    expect(await sendEmail("a@b.com", "s", "t")).toBe(false);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await sendEmail("a@b.com", "s", "t")).toBe(false);
  });

  it("every caller imports the one email module and nothing refers to SendGrid any more", () => {
    for (const rel of ["lib/email.ts", "lib/trainer-dispatch-advance.ts", "lib/cron-monitor.ts", ".env.local.example"]) {
      expect(readFileSync(join(__dirname, "..", rel), "utf8").toLowerCase(), rel).not.toContain("sendgrid");
    }
    expect(readFileSync(join(__dirname, "..", "lib/trainer-dispatch-advance.ts"), "utf8")).toContain("isEmailConfigured()");
  });
});
