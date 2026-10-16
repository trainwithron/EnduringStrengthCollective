import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("the ten writes whose failure used to look like success now tell the truth", () => {
  const checkedIn = (path: string, ...pieces: string[]) => {
    const s = src(path);
    expect(s, path).toContain('from "@/lib/checked-write"');
    for (const piece of pieces) expect(s, `${path}: ${piece}`).toContain(piece);
  };
  it("consent and injury (Release 3), training-partner block, coach note and its visibility, package assignment", () => {
    checkedIn("components/coach/minor-consent-control.tsx", "expectRows: true");
    checkedIn("components/coach/injury-status-toggle.tsx", "expectRows: true");
    checkedIn("components/athlete/training-partner-browse-list.tsx", "Couldn't block that person. Nothing was changed. Try again.");
    checkedIn("components/coach/desktop/recap-exercise-row.tsx", "Couldn't save the note. Try again.", "setVisibleToAthlete(before)");
    checkedIn("components/coach/package-assignment-control.tsx", "Couldn't take that package away", "Couldn't give that package to this client");
  });
  it("waiver text and file, workout assignment and calendar drop, tag manager", () => {
    checkedIn("components/coach/desktop/waiver-settings.tsx", "Couldn't save the waiver text. It was not changed. Try again.");
    checkedIn("components/coach/desktop/waiver-pdf-upload.tsx", "Couldn't attach that file to your waiver", 'storage.from("waiver-documents").remove([newPath])');
    checkedIn("components/coach/desktop/assign-workout-form.tsx", "Couldn't assign that workout. Nothing was changed. Try again.", "Couldn't clear that day");
    checkedIn("components/coach/desktop/client-calendar-grid.tsx", "Couldn't put that workout on that day");
    checkedIn("components/coach/desktop/client-tag-manager.tsx", "Couldn't delete that tag", "It was put back the way it was", "setTags(before)");
  });
  it("the needs-you strip and rail never say 'nothing needs a look' when the check failed", () => {
    const strip = src("components/coach/desktop/needs-attention-strip.tsx");
    expect(strip).toContain("Couldn&apos;t check what needs your attention.");
    expect(strip).not.toContain("catch(() => ({ items: [] }))");
    const rail = src("components/coach/desktop/rail-widgets/clients-rail-widget.tsx");
    expect(rail).toContain("Couldn't check. Open Clients to see.");
    expect(rail).not.toContain("catch(() => ({ items: [] }))");
  });
});

describe("the Stripe webhook throws on a failed write so Stripe sends the event again", () => {
  const hook = src("app/api/stripe/webhook/route.ts");
  it("the plan started by checkout, the saved transfer id and the connected-account status", () => {
    expect(hook).toContain("if (liftOffStartError) throw liftOffStartError;");
    expect(hook).toContain("if (transferSaveError) throw transferSaveError;");
    expect(hook).toContain("if (connectStatusError) throw connectStatusError;");
    expect(hook).toContain("Webhook handler failed");
  });
});

describe("pages say so when their data could not be read", () => {
  it("the notifications page and the session ledger show Try again, not an empty list", () => {
    expect(src("app/notifications/page.tsx")).toContain("rowsError ? <LoadFailed />");
    expect(src("app/(coach)/groups/[groupId]/business/session-ledger/page.tsx")).toContain("athleteError || creditError ? (");
    const lf = src("components/ui/load-failed.tsx");
    expect(lf).toContain("Couldn't load this. Try again.");
    expect(lf).toContain("router.refresh()");
  });
});

describe("reminder jobs claim before they send, so a failed mark never repeats a message", () => {
  it("the session reminder and the waitlist offer", () => {
    const reminder = src("app/api/cron/session-reminder/route.ts");
    expect(reminder.indexOf('.is("reminder_sent_at", null)\n      .select("id")')).toBeGreaterThan(0);
    expect(reminder.indexOf("if (claimError || (claimed ?? []).length === 0) continue;")).toBeLessThan(reminder.indexOf("sendPushToProfile("));
    const wait = src("app/api/cron/process-booking-waitlist/route.ts");
    expect(wait.indexOf("if (claimError || (claimed ?? []).length === 0) continue;")).toBeLessThan(wait.indexOf("sendPushToProfile("));
  });
});
