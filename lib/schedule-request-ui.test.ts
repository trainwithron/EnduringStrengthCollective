import { describe, expect, it } from "vitest";
import {
  SHEET_COPY,
  addDays,
  dayLabel,
  freezeLengthOptions,
  isOverdue,
  openRequest,
  requestStatusLine,
  requestableKinds,
  scheduleStateLine,
  scheduleSummary,
  timeLabel,
  todayKey,
  type RequestForUi,
} from "./schedule-request-ui";

const NOW = new Date("2026-10-13T12:00:00Z");
const req = (patch: Partial<RequestForUi> = {}): RequestForUi => ({
  id: "r1", seriesId: "s1", kind: "pause", effectiveOn: "2026-11-03", resumeOn: null, status: "pending", createdAt: "2026-10-12T12:00:00Z", appliedAt: null, appliedEarly: false, ...patch,
});
const MONEY = /pay|owe|refund|credit|charge|price|cost|fee|\$|balance|expire|session[s]? left|unused/i;

describe("the schedule in plain words", () => {
  it("writes the weekly time and the state", () => {
    expect(scheduleSummary({ weekday: 2, startTime: "06:00:00", durationMinutes: 60 })).toBe("Tuesdays at 6:00 AM, 60 minutes");
    expect(scheduleSummary({ weekday: 4, startTime: "17:30", durationMinutes: 45 })).toBe("Thursdays at 5:30 PM, 45 minutes");
    expect(timeLabel("12:00")).toBe("12:00 PM");
    expect(timeLabel("00:15")).toBe("12:15 AM");
    expect(scheduleStateLine({ status: "active", frozenUntil: null, endsOn: null })).toBe("Active");
    expect(scheduleStateLine({ status: "paused", frozenUntil: null, endsOn: null })).toBe("Paused");
    expect(scheduleStateLine({ status: "paused", frozenUntil: "2026-11-03", endsOn: null })).toBe("Frozen until Nov 3");
    expect(scheduleStateLine({ status: "ended", frozenUntil: null, endsOn: "2026-11-03" })).toBe("Ended Nov 3");
  });
  it("dates are calendar days: no time zone can move them", () => {
    expect(dayLabel("2026-11-03")).toBe("Nov 3");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 7)).toBe("2027-01-07");
    expect(freezeLengthOptions("2026-11-03").map((o) => o.resumeOn)).toEqual(["2026-11-10", "2026-11-17", "2026-12-01", "2026-12-29", "2027-01-26"]);
  });
  it("today for the date picker is the schedule's own day", () => {
    // 03:00 UTC on Oct 14 is still Oct 13 in New York and already Oct 14 in Auckland
    const t = new Date("2026-10-14T03:00:00Z");
    expect(todayKey("America/New_York", t)).toBe("2026-10-13");
    expect(todayKey("Pacific/Auckland", t)).toBe("2026-10-14");
    expect(todayKey(null, t)).toBe("2026-10-13");
  });
  it("which requests a client may make follows the schedule's state", () => {
    expect(requestableKinds("active")).toEqual(["pause", "freeze", "cancel"]);
    expect(requestableKinds("paused")).toEqual(["cancel"]);
    expect(requestableKinds("ended")).toEqual([]);
    expect(requestableKinds("cancelled")).toEqual([]);
  });
});

describe("the status of a request", () => {
  it("a new request says it was sent and that the coach will reach out", () => {
    expect(requestStatusLine(req(), "Oct 12", NOW)).toBe("Request sent Oct 12: pause after Nov 3. Your coach will reach out.");
    expect(requestStatusLine(req({ kind: "cancel" }), "Oct 12", NOW)).toContain("end after Nov 3");
  });
  it("after about two days unanswered it says so, once the request is still waiting", () => {
    const old = req({ createdAt: "2026-10-10T12:00:00Z" });
    expect(isOverdue(old, NOW)).toBe(true);
    expect(requestStatusLine(old, "Oct 10", NOW)).toContain("Your coach hasn't replied yet.");
    expect(isOverdue(req({ createdAt: "2026-10-12T13:00:00Z" }), NOW)).toBe(false);
    expect(isOverdue(req({ status: "applied", createdAt: "2026-10-01T00:00:00Z" }), NOW)).toBe(false);
  });
  it("an applied request tells the client the outcome; a freeze names the day it starts again", () => {
    expect(requestStatusLine(req({ status: "applied" }), "Oct 12", NOW)).toMatch(/paused/);
    expect(requestStatusLine(req({ status: "applied", kind: "freeze", resumeOn: "2026-12-01" }), "Oct 12", NOW)).toBe("Your weekly schedule is frozen. It starts again Dec 1.");
    expect(requestStatusLine(req({ status: "applied", kind: "cancel" }), "Oct 12", NOW)).toContain("has ended");
    expect(requestStatusLine(req({ status: "applied", kind: "freeze", resumeOn: "2026-10-05", appliedAt: "2026-10-13T08:00:00Z" }), "Oct 12", NOW)).toContain("had already ended");
    expect(requestStatusLine(req({ status: "withdrawn" }), "Oct 12", NOW)).toBe("You took this request back.");
    expect(requestStatusLine(req({ status: "dismissed" }), "Oct 12", NOW)).toBe("Your coach has handled this request.");
  });
  it("finds the one open request for a schedule", () => {
    expect(openRequest([req({ status: "applied" }), req({ id: "r2" })])?.id).toBe("r2");
    expect(openRequest([req({ status: "withdrawn" })])).toBeNull();
    expect(openRequest([req({ id: "r3", seriesId: "other" })], "s1")).toBeNull();
  });
});

describe("the words never touch money", () => {
  it("no sentence a client reads mentions money, credits, expiry or what is owed", () => {
    const sentences = [
      ...Object.values(SHEET_COPY).flatMap((c) => [c.title, c.intro, c.dateLabel, c.button]),
      ...(["pending", "applied", "dismissed", "withdrawn"] as const).flatMap((status) =>
        (["pause", "freeze", "cancel"] as const).map((kind) => requestStatusLine(req({ status, kind, resumeOn: kind === "freeze" ? "2026-12-01" : null }), "Oct 12", NOW))
      ),
    ];
    for (const s of sentences) expect(s, s).not.toMatch(MONEY);
  });
  it("sentence case: every sheet title and button starts with a capital and has no shouting", () => {
    for (const c of Object.values(SHEET_COPY)) {
      expect(c.title).toMatch(/^[A-Z][a-z]/);
      expect(c.button).toMatch(/^[A-Z][a-z]/);
      expect(c.title).not.toMatch(/[A-Z]{3,}/);
    }
  });
});
