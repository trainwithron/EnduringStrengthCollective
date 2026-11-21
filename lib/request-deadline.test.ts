import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { answerByText, askedWhat, dueForLapseWarning, isUrgentRequest, lapsedMessage, lapseWarningMessage, requestDeadline } from "./request-deadline";

// Wave 3 C1 (Ron, Nov 20): every waiting request that can lapse says "Answer by {time}"; the coach is warned about two hours before, and told after it lapsed (who, what,
// and that the client was told). When it lapses is unchanged. C9: urgent = sent within 12 hours of its lapse.
const TZ = "America/New_York";
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("when a request lapses (the database's own rule, unchanged)", () => {
  it("a new session at its time; a move at the ORIGINAL session's time", () => {
    expect(requestDeadline({ kind: "new", new_start_at: "2026-11-21T14:00:00Z" })).toBe("2026-11-21T14:00:00Z");
    expect(requestDeadline({ kind: "move", from_start_at: "2026-11-21T14:00:00Z", new_start_at: "2026-11-23T15:00:00Z" })).toBe("2026-11-21T14:00:00Z");
    // (step 218 never patches expire_stale_booking_requests)
    expect(read("supabase/migrations/0462_wave3_calendar.sql")).not.toContain("expire_stale_booking_requests(");
  });
});

describe("Answer by", () => {
  const now = new Date("2026-11-20T15:00:00Z"); // 10 AM in New York
  it("today, tomorrow, or the date, in the coach's own clock", () => {
    expect(answerByText("2026-11-20T21:00:00Z", TZ, now)).toBe("Answer by 4:00 PM");
    expect(answerByText("2026-11-21T14:00:00Z", TZ, now)).toBe("Answer by tomorrow 9:00 AM");
    expect(answerByText("2026-11-24T14:00:00Z", TZ, now)).toBe("Answer by Tue, Nov 24, 9:00 AM");
  });
  it("is shown on Requests and Home's decision list, Home's Needs you line, and the coach's push", () => {
    expect(read("components/coach/late-changes-panel.tsx")).toContain("{answerByText(requestDeadline({ kind: m.kind, from_start_at: m.fromStartAt, new_start_at: m.newStartAt }), timezone)}");
    expect(read("lib/needs-you-data.ts")).toContain("sentences.bookingRequest(r.kind, answerByText(requestDeadline(r), input.timezone))");
    expect(read("lib/notification-push.ts")).toContain("const by = answerByText(requestDeadline(r), timeZone, now);");
  });
});

describe("the two-hour warning and the lapse notice", () => {
  const now = new Date("2026-11-20T19:00:00Z"); // 2 PM in New York
  it("due inside the last two hours only", () => {
    expect(dueForLapseWarning("2026-11-20T21:00:00Z", now)).toBe(true);
    expect(dueForLapseWarning("2026-11-20T21:00:01Z", now)).toBe(false);
    expect(dueForLapseWarning("2026-11-20T19:00:00Z", now)).toBe(false);
  });
  it("say who, what, and (after) that the client was told", () => {
    const what = askedWhat({ kind: "new", new_start_at: "2026-11-20T21:00:00Z" }, TZ);
    expect(lapseWarningMessage("Hewan B.", what, "2026-11-20T21:00:00Z", TZ, now).body).toBe("Answer by 4:00 PM or it lapses. Hewan B. asked for Fri, Nov 20, 4:00 PM.");
    expect(lapsedMessage("Hewan B.", what).body).toBe("Hewan B. asked for Fri, Nov 20, 4:00 PM. Nobody answered before the time came, so it lapsed. Hewan B. was told.");
  });
  it("the job warns before the database lapses requests and tells after, each claimed once and given back when nothing was delivered", () => {
    const cron = read("app/api/cron/process-booking-waitlist/route.ts");
    expect(cron).toMatch(/warnBeforeLapse\(supabase, now\);\s*const \{ data: lapsed \} = await supabase\.rpc\("expire_stale_booking_requests"\);\s*const lapseNotices = await tellLapsed\(supabase, now\);/);
    const job = read("lib/request-lapse-job.ts");
    expect(job).toContain('.update({ lapse_warned_at: stamp }).eq("id", r.id).eq("status", "pending").is("lapse_warned_at", null)');
    expect(job).toContain('.update({ lapse_warned_at: null }).eq("id", r.id).eq("lapse_warned_at", stamp)');
    expect(job).toContain('.update({ lapse_told_at: stamp }).eq("id", r.id).is("lapse_told_at", null)');
    expect(job).toContain('.update({ lapse_told_at: null }).eq("id", r.id).eq("lapse_told_at", stamp)');
  });
});

describe("C9: urgent requests", () => {
  it("sent within 12 hours of when it would lapse", () => {
    expect(isUrgentRequest({ kind: "new", new_start_at: "2026-11-21T09:00:00Z", created_at: "2026-11-20T21:00:01Z" })).toBe(true);
    expect(isUrgentRequest({ kind: "new", new_start_at: "2026-11-21T09:00:00Z", created_at: "2026-11-20T20:59:59Z" })).toBe(false);
  });
});

describe("C9: the coach's quiet hours give way for a session starting soon", () => {
  it("the five-minute job sends an urgent session request through the coach's quiet hours, push and email, and holds the rest as before", () => {
    const job = read("app/api/cron/notification-push/route.ts");
    expect(job).toContain('const ids = candidates.filter((c) => !quietNow.has(c.profile_id) || urgent.has(c.id)).map((c) => c.id);');
    expect(job).toContain("...(urgent.has(n.id) ? { ignoreQuiet: true } : {})");
    expect(job).toContain("{ ignoreQuiet: urgent.has(n.id) }");
    const lib = read("lib/notification-push.ts");
    expect(lib).toMatch(/return !!r && r\.status === "pending" && isUrgentRequest\(r\);/);
    expect(read("lib/client-notice-email.ts")).toContain("if (!opts.ignoreQuiet && isQuietNow(prefs)) return \"quiet\";");
  });
  it("and the client is then not promised a reply in the morning: no line at all", async () => {
    const { lapsesSoon } = await import("./request-deadline");
    const now = new Date("2026-11-21T03:00:00Z");
    expect(lapsesSoon("2026-11-21T14:59:59Z", now)).toBe(true);
    expect(lapsesSoon("2026-11-21T15:00:01Z", now)).toBe(false);
    expect(lapsesSoon(null, now)).toBe(false);
    const notice = read("components/athlete/quiet-hours-notice.tsx");
    expect(notice).toMatch(/if \(lapsesSoon\(lapse\)\) \{\s*onLine\?\.\(null\);\s*return;\s*\}/);
    expect(read("components/athlete/request-slot-button.tsx")).toContain("lapsesAt={startAt}");
    expect(read("components/athlete/request-different-time.tsx")).toContain("lapsesAt={sentAt}");
    // a move lapses at the session's own (original) time, read with the coach
    expect(notice).toContain('.select("coach_id, start_at")');
  });
});
