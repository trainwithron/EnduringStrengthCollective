import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/app-url", () => ({ configuredAppUrl: () => "https://app.example" }));
import { EMAIL_BACKUP_TYPES, emailsWhenNoPhone, noticeBackupEmail } from "./notice-email-backup";

// Wave 2 C3 (Ron, Nov 20: "we can send the emails"): a push that reached no phone is followed by an email, for a coach's requests and a client's answer only.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

describe("which notices get an email when no phone was reached", () => {
  it("the coach's three requests to answer and the client's answer, nothing else", () => {
    expect([...EMAIL_BACKUP_TYPES].sort()).toEqual(["booking_request", "client_request", "request_decision", "schedule_request"]);
    expect(emailsWhenNoPhone("comment")).toBe(false);
    expect(emailsWhenNoPhone("late_change")).toBe(false);
    expect(emailsWhenNoPhone("support_reply")).toBe(false);
  });
});

describe("what the email says", () => {
  it("the push's title, the line, and a link straight to the request", () => {
    const mail = noticeBackupEmail({ id: "n1", type: "booking_request", group_id: "g1", link_path: "/dashboard" }, "Hewan B. asked for Thu Nov 19, 9:00 AM");
    expect(mail.subject).toBe("New booking request");
    expect(mail.text).toContain("Hewan B. asked for Thu Nov 19, 9:00 AM.");
    expect(mail.text).toContain("Open it: https://app.example/requests?notice=n1");
  });
});

describe("where it is sent from", () => {
  it("the five-minute job emails only when the push reached no phone, after the notice was claimed", () => {
    const job = read("app/api/cron/notification-push/route.ts");
    expect(job).toContain("if (reached === 0 && (await emailNoticeBackup(db, n, isRequest ? line : n.body || line)) === \"sent\") emailed += 1;");
  });
  it("the answer pushed right away does the same", () => {
    const now = read("lib/push-now.ts");
    expect(now).toContain("if (reached === 0) await emailNoticeBackup(db, { ...n, profile_id: profileId }, n.body || pushBodyFor(n.type));");
  });
  it("goes through the client notice sender: quiet hours and placeholder addresses are respected", () => {
    expect(read("lib/notice-email-backup.ts")).toContain("return await emailClientNotice(db, n.profile_id, mail.subject, mail.text);");
  });
});
