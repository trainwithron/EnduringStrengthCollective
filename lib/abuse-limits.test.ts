import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isSafeWebhookUrl } from "@/lib/webhook-url";
import { AI_INPUT_LIMITS, aiInputTooLong } from "@/lib/ai-usage";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("isSafeWebhookUrl", () => {
  it("accepts a public https address", () => {
    expect(isSafeWebhookUrl("https://hooks.zapier.com/hooks/standard/123/abc/")).toBe(true);
    expect(isSafeWebhookUrl("https://example.com:443/x")).toBe(true);
  });
  it("refuses http, other ports, credentials and bare names", () => {
    expect(isSafeWebhookUrl("http://hooks.zapier.com/x")).toBe(false);
    expect(isSafeWebhookUrl("https://example.com:8443/x")).toBe(false);
    expect(isSafeWebhookUrl("https://user:pw@example.com/x")).toBe(false);
    expect(isSafeWebhookUrl("https://localhost/x")).toBe(false);
    expect(isSafeWebhookUrl("https://metadata/x")).toBe(false);
  });
  it("refuses addresses inside our own network, however they are written", () => {
    for (const u of [
      "https://169.254.169.254/latest/meta-data",
      "https://127.0.0.1/",
      "https://10.0.0.5/",
      "https://192.168.1.1/",
      "https://172.16.0.1/",
      "https://[::1]/",
      "https://service.internal/x",
      "https://printer.local/x",
      "https://2130706433/",
    ]) {
      expect(isSafeWebhookUrl(u)).toBe(false);
    }
  });
  it("refuses junk", () => {
    expect(isSafeWebhookUrl("")).toBe(false);
    expect(isSafeWebhookUrl(null)).toBe(false);
    expect(isSafeWebhookUrl("not a url")).toBe(false);
    expect(isSafeWebhookUrl("https://example.com/" + "a".repeat(2100))).toBe(false);
  });
  it("is checked when saved and again before every call, which cannot hang or follow a redirect", () => {
    expect(read("app/api/zapier/subscriptions/route.ts")).toContain("isSafeWebhookUrl(target_url)");
    const d = read("lib/webhook-dispatch.ts");
    expect(d).toContain("if (isSafeWebhookUrl(params.targetUrl) && (await hostResolvesPublic(params.targetUrl");
    expect(d).toContain('redirect: "error"');
    expect(d).toContain("AbortSignal.timeout(WEBHOOK_TIMEOUT_MS)");
  });
});

describe("AI input caps and coach-only AI tools", () => {
  it("the two routes that had no cap now have one", () => {
    expect(AI_INPUT_LIMITS.video_checkin_summary).toBe(3000);
    expect(AI_INPUT_LIMITS.biomech_tag_suggest).toBe(120);
    expect(aiInputTooLong("biomech_tag_suggest", "x".repeat(121))).toMatch(/too long/);
    expect(aiInputTooLong("video_checkin_summary", "x".repeat(150000))).toMatch(/too long/);
    expect(read("app/api/coach/video-checkin/summarize/route.ts")).toContain('aiInputTooLong("video_checkin_summary", notes)');
    expect(read("app/api/biomech-tags/suggest/route.ts")).toContain('aiInputTooLong("biomech_tag_suggest", exerciseName)');
  });
  it("recipe and quick-add parsing are for coaches only", () => {
    for (const f of ["app/api/ai/parse-recipe/route.ts", "app/api/ai/parse-session-nl/route.ts"]) {
      expect(read(f)).toContain("await userIsCoach(supabase, user.id)");
    }
  });
});

describe("email-sending routes and signup", () => {
  it("coach invites and claim-link emails have daily ceilings", () => {
    const invite = read("app/api/coaches/invite/route.ts");
    expect(invite).toContain('rateLimitResponse("coach-invite-hour", user.id, 10, 3600)');
    expect(invite).toContain('rateLimitResponse("coach-invite-day", user.id, 30, 86400)');
    expect(read("app/api/clients/email-claim-link/route.ts")).toContain('rateLimitResponse("email-claim-link-day", user.id, 60, 86400)');
  });
  it("signup does not reveal whether an address has an account, and does not echo database errors", () => {
    const s = read("app/api/coaches/signup/route.ts");
    expect(s).toContain("coach-signup-email:");
    expect(s).toContain("pendingConfirmation: true, confirmationEmailSent: true, legalRecorded: true");
    expect(s).not.toContain("profileError.message }");
    expect(s).not.toContain("err instanceof Error ? err.message : \"Couldn't set up");
  });
  it("signing out removes this device's push subscription first, and a device can only belong to one person", () => {
    expect(read("components/group/sign-out-button.tsx").indexOf("unsubscribeFromPush()")).toBeLessThan(read("components/group/sign-out-button.tsx").indexOf("supabase.auth.signOut()"));
    expect(read("app/api/push/subscribe/route.ts")).toContain('.eq("endpoint", endpoint).neq("profile_id", user.id)');
  });
});
