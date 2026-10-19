import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { guardianWaitNoticeBody, waitingOnGuardian, WAITING_ON_GUARDIAN_LABEL } from "@/lib/guardian-wait";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const NOW = new Date("2026-10-19T12:00:00Z");

// Oct 19 audit item 14: Sawyer S., 16, filled the whole health form and hit "A parent or guardian needs to give permission first" with no way forward; the coach was never told.
describe("who is waiting on a guardian", () => {
  it("a client aged 13 to 17 with no signed permission", () => {
    expect(waitingOnGuardian("2010-03-01", false, NOW)).toBe(true); // 16
    expect(waitingOnGuardian("2013-10-19", false, NOW)).toBe(true); // just turned 13
    expect(waitingOnGuardian("2008-10-20", false, NOW)).toBe(true); // 17, turns 18 tomorrow
  });
  it("not once a guardian has signed, not an adult, not a child under 13, not a client with no date", () => {
    expect(waitingOnGuardian("2010-03-01", true, NOW)).toBe(false);
    expect(waitingOnGuardian("2008-10-19", false, NOW)).toBe(false); // 18 today
    expect(waitingOnGuardian("2015-01-01", false, NOW)).toBe(false); // under 13: blocked, a different message
    expect(waitingOnGuardian(null, false, NOW)).toBe(false);
  });
  it("the words", () => {
    expect(WAITING_ON_GUARDIAN_LABEL).toBe("Waiting on a guardian");
    expect(guardianWaitNoticeBody("Sawyer S.")).toBe("Sawyer S. is under 18 and needs a parent or guardian's OK before starting. They are asked for it on their screen; you can send it again from their profile.");
    expect(guardianWaitNoticeBody(null)).toContain("A client is under 18");
  });
});

describe("the health form no longer dead-ends a teen", () => {
  const form = read("components/intake/intake-form.tsx");
  it("after the birth date saves, a client aged 13 to 17 goes straight to the guardian screen (the birthday page) and comes back to the form after, and the coach is told", () => {
    expect(form).toContain('if (ageBand(dateOfBirth, new Date()) === "teen") {');
    expect(form).toContain('router.push(`/birthday?next=${encodeURIComponent("/intake")}`);');
    expect(form).toContain('fetch("/api/intake/minor-consent-notice"');
    // the step to the form comes AFTER that early return
    expect(form.indexOf('=== "teen") {')).toBeLessThan(form.indexOf('setStep(isUnder13(dateOfBirth, new Date()) && !parentalConsentVerified ? "blocked" : "form");'));
  });
  it("the birthday step tells the coach about a teen too", () => {
    expect(read("components/intake/birthday-form.tsx")).toContain('if (ageBand(dob, new Date()) === "teen") void fetch("/api/intake/minor-consent-notice"');
  });
});

describe("the coach's notice", () => {
  const route = read("app/api/intake/minor-consent-notice/route.ts");
  it("is sent for a teen only while no guardian has signed, and keeps the once-a-week limit per coach", () => {
    expect(route).toContain('.eq("status", "signed")');
    expect(route).toContain("teenWaiting = !signed;");
    expect(route).toContain("if (!under13 && !teenWaiting) {");
    expect(route).toContain("weekAgo");
    expect(route).toContain('under13 ? consentNoticeBody(childName) : guardianWaitNoticeBody(childName)');
  });
});

describe("the Clients list mark", () => {
  it("is read for the coach's own clients (birth dates, then signed permissions with the server's access) and shown on the list row and the card", () => {
    const page = read("app/(coach)/clients/page.tsx");
    expect(page).toContain('from("client_intake").select("athlete_id, date_of_birth")');
    expect(page).toContain('.eq("status", "signed")');
    expect(page).toContain("waitingOnGuardian: waitingOnGuardian(dobByClient.get(c.id), signedTeens.has(c.id)),");
    const list = read("components/coach/desktop/coach-clients-list.tsx");
    expect(list.match(/\{c\.waitingOnGuardian && /g)?.length).toBe(2);
  });
});
