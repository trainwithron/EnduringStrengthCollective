import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SMS_MONTHLY_CAP_DEFAULT, SMS_MONTHLY_CAP_MESSAGE, smsMonthlyCap, startOfMonthUtc } from "@/lib/sms-dispatch";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("The monthly text cap", () => {
  afterEach(() => {
    delete process.env.SMS_MONTHLY_CAP_PER_COACH;
  });
  it("is 60 a month by default and can be changed", () => {
    expect(SMS_MONTHLY_CAP_DEFAULT).toBe(60);
    expect(smsMonthlyCap()).toBe(60);
    process.env.SMS_MONTHLY_CAP_PER_COACH = "25";
    expect(smsMonthlyCap()).toBe(25);
    process.env.SMS_MONTHLY_CAP_PER_COACH = "nonsense";
    expect(smsMonthlyCap()).toBe(60);
  });
  it("counts from the first of the month, UTC", () => {
    expect(startOfMonthUtc(new Date("2026-10-31T23:59:00Z"))).toBe("2026-10-01T00:00:00.000Z");
    expect(startOfMonthUtc(new Date("2026-11-01T00:00:00Z"))).toBe("2026-11-01T00:00:00.000Z");
  });
  it("is checked before every send, in the one function every text goes through, ahead of the daily limit", () => {
    const d = read("lib/sms-dispatch.ts");
    expect(d.indexOf("monthly_cap")).toBeGreaterThan(-1);
    expect(d.indexOf('return { sent: false, reason: "monthly_cap" }')).toBeLessThan(d.indexOf('reason: "daily_cap"'));
    expect(d.indexOf('return { sent: false, reason: "monthly_cap" }')).toBeLessThan(d.indexOf("sendSms(normalizedPhone"));
  });
  it("says it plainly", () => {
    expect(SMS_MONTHLY_CAP_MESSAGE).toBe("You've used this month's text messages. Clients still get in-app messages and notifications.");
    const page = read("app/(coach)/groups/[groupId]/business/sms-settings/page.tsx");
    expect(page).toContain("Text messages this month: {used} of {cap}.");
    expect(page).toContain(">Text messages</h1>");
  });
});

describe("Texting is not advertised", () => {
  it("it is no longer in the Business sidebar or the phone's Business list; it lives under Settings / Other as Text messages", () => {
    const shell = read("components/coach/coach-desktop-shell.tsx");
    expect(shell).not.toContain("SMS Notifications");
    expect(shell).toContain('label: "Text messages"');
    const phone = read("components/coach/mobile/coach-nav-links-list.tsx");
    expect(phone).not.toContain("SMS notifications");
    expect(phone.indexOf('label="Text messages"')).toBeGreaterThan(phone.indexOf('GroupHeader label="Other"'));
  });
});
