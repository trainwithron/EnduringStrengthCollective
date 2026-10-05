import { describe, expect, it } from "vitest";
import {
  computePublicSlots,
  guestChangeAllowed,
  isBotSubmission,
  isUuid,
  normalizeSlug,
  priceLabelFor,
  publicSessionTypes,
  slotIsOffered,
  slugProblem,
  validateGuestInput,
  whereLabel,
  type PublicSessionTypeRow,
} from "@/lib/public-booking";

describe("addresses", () => {
  it("turns a typed name into an address", () => {
    expect(normalizeSlug("Ron Arnold")).toBe("ron-arnold");
    expect(normalizeSlug("  Ron's Gym!!  ")).toBe("rons-gym");
    expect(normalizeSlug("José  Peña")).toBe("jose-pena");
    expect(normalizeSlug("--a--b--")).toBe("a-b");
  });

  it("caps the length without leaving a trailing dash", () => {
    const s = normalizeSlug("a".repeat(39) + " b");
    expect(s.length).toBeLessThanOrEqual(40);
    expect(s.endsWith("-")).toBe(false);
  });

  it("accepts good addresses", () => {
    expect(slugProblem("ron")).toBeNull();
    expect(slugProblem("ron-arnold-strength")).toBeNull();
    expect(slugProblem("coach-42")).toBeNull();
  });

  it("rejects bad ones", () => {
    expect(slugProblem("ab")).toMatch(/at least 3/);
    expect(slugProblem("x".repeat(41))).toMatch(/40/);
    expect(slugProblem("-ron")).toMatch(/lowercase/);
    expect(slugProblem("Ron")).toMatch(/lowercase/);
    expect(slugProblem("ro n")).toMatch(/lowercase/);
  });

  it("reserves words that are or could be real pages", () => {
    expect(slugProblem("manage")).toMatch(/reserved/);
    expect(slugProblem("admin")).toMatch(/reserved/);
    expect(slugProblem("api")).toMatch(/reserved/);
  });

  it("rejects an address that looks like an id, so it can never be mistaken for the older id link", () => {
    expect(isUuid("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
    expect(slugProblem("123e4567-e89b-12d3-a456-426614174000")).toMatch(/id/);
    expect(isUuid("ron")).toBe(false);
  });
});

describe("what a visitor types", () => {
  it("accepts a normal booking", () => {
    const r = validateGuestInput({ name: "  Sam   Lee ", email: " Sam@Example.COM ", phone: "(555) 123-4567", note: "Knee is sore" });
    expect(r).toEqual({ ok: true, value: { name: "Sam Lee", email: "sam@example.com", phone: "(555) 123-4567", note: "Knee is sore" } });
  });

  it("phone and note are optional", () => {
    const r = validateGuestInput({ name: "Sam", email: "sam@example.com" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.phone).toBeNull();
      expect(r.value.note).toBeNull();
    }
  });

  it("rejects a missing name, a bad email, a bad phone, a long note", () => {
    expect(validateGuestInput({ name: "", email: "a@b.co" }).ok).toBe(false);
    expect(validateGuestInput({ name: "x".repeat(81), email: "a@b.co" }).ok).toBe(false);
    expect(validateGuestInput({ name: "Sam", email: "not an email" }).ok).toBe(false);
    expect(validateGuestInput({ name: "Sam", email: "a@b" }).ok).toBe(false);
    expect(validateGuestInput({ name: "Sam", email: "a@b.co", phone: "call me maybe" }).ok).toBe(false);
    expect(validateGuestInput({ name: "Sam", email: "a@b.co", note: "x".repeat(501) }).ok).toBe(false);
  });
});

describe("bot checks", () => {
  const now = new Date("2026-10-10T12:00:10Z");
  it("a filled hidden field is a bot", () => {
    expect(isBotSubmission({ honeypot: "http://spam", renderedAtMs: now.getTime() - 20000, now })).toBe(true);
  });
  it("a form sent in under 2 seconds is a bot", () => {
    expect(isBotSubmission({ honeypot: "", renderedAtMs: now.getTime() - 500, now })).toBe(true);
  });
  it("a normal submission passes", () => {
    expect(isBotSubmission({ honeypot: "", renderedAtMs: now.getTime() - 15000, now })).toBe(false);
  });
  it("a missing timestamp does not by itself mark a bot", () => {
    expect(isBotSubmission({ honeypot: "", renderedAtMs: undefined, now })).toBe(false);
  });
});

describe("what is shown", () => {
  const row = (over: Partial<PublicSessionTypeRow>): PublicSessionTypeRow => ({
    id: "t",
    name: "Training",
    durationMinutes: 60,
    locationKind: "in_person",
    locationText: null,
    description: null,
    displayPriceCents: 9500,
    publicVisible: true,
    sortOrder: 0,
    ...over,
  });

  it("only public session types are listed, in order", () => {
    const list = publicSessionTypes(
      [row({ id: "b", name: "B", sortOrder: 2 }), row({ id: "a", name: "A", sortOrder: 1 }), row({ id: "h", name: "Hidden", publicVisible: false })],
      true
    );
    expect(list.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("prices stay hidden unless the page shows prices AND the type has one", () => {
    expect(priceLabelFor(9500, false)).toBeNull();
    expect(priceLabelFor(null, true)).toBeNull();
    expect(priceLabelFor(9500, true)).toBe("$95");
    expect(priceLabelFor(5250, true)).toBe("$52.50");
    expect(priceLabelFor(0, true)).toBe("$0");
    expect(publicSessionTypes([row({})], false)[0].priceLabel).toBeNull();
  });

  it("says where a session happens", () => {
    expect(whereLabel("in_person", null)).toBe("In person");
    expect(whereLabel("online", "Zoom")).toBe("Online: Zoom");
    expect(whereLabel("either", "  ")).toBe("In person or online");
  });
});

describe("open times", () => {
  const NY = "America/New_York";
  const now = new Date("2026-10-13T12:00:00Z"); // Tuesday 8:00 AM New York
  const tuesdayHours = [{ weekday: 2, startTime: "09:00", endTime: "12:00", slotDurationMinutes: 30 }];
  const base = { now, timezone: NY, windows: tuesdayHours, exceptions: [], busy: [], bufferMinutes: 0, minimumNoticeHours: 0, durationMinutes: 60 };

  it("steps through the coach's hours by the session length, not the window's own slot length", () => {
    const slots = computePublicSlots({ ...base, days: 1 });
    // Today (Tuesday) 9:00, 10:00, 11:00 New York = 13:00Z, 14:00Z, 15:00Z.
    expect(slots.map((s) => s.startIso)).toEqual(["2026-10-13T13:00:00.000Z", "2026-10-13T14:00:00.000Z", "2026-10-13T15:00:00.000Z"]);
  });

  it("a 30 minute type gets twice as many starts", () => {
    expect(computePublicSlots({ ...base, durationMinutes: 30, days: 1 })).toHaveLength(6);
  });

  it("leaves out the past and anything inside the minimum notice", () => {
    const afterTen = computePublicSlots({ ...base, now: new Date("2026-10-13T14:30:00Z"), days: 1 }); // 10:30 AM
    expect(afterTen.map((s) => s.startIso)).toEqual(["2026-10-13T15:00:00.000Z"]);
    const withNotice = computePublicSlots({ ...base, minimumNoticeHours: 3, days: 1 }); // until 11:00 AM
    expect(withNotice.map((s) => s.startIso)).toEqual(["2026-10-13T15:00:00.000Z"]);
  });

  it("leaves out booked times and the buffer around them", () => {
    const busy = [{ start: new Date("2026-10-13T14:00:00Z"), end: new Date("2026-10-13T15:00:00Z") }];
    expect(computePublicSlots({ ...base, busy, days: 1 }).map((s) => s.startIso)).toEqual(["2026-10-13T13:00:00.000Z", "2026-10-13T15:00:00.000Z"]);
    expect(computePublicSlots({ ...base, busy, bufferMinutes: 15, days: 1 })).toHaveLength(0);
  });

  it("leaves out time off", () => {
    const exceptions = [{ kind: "one_off" as const, startAt: "2026-10-13T00:00:00Z", endAt: "2026-10-14T05:00:00Z", weekday: null, startTime: null, endTime: null }];
    expect(computePublicSlots({ ...base, exceptions, days: 1 })).toHaveLength(0);
  });

  it("looks ahead 28 days by default and only offers hours on the right weekday", () => {
    const slots = computePublicSlots({ ...base });
    const days = new Set(slots.map((s) => s.dateKey));
    expect(days.has("2026-10-13")).toBe(true);
    expect(days.has("2026-10-20")).toBe(true);
    expect(days.has("2026-10-14")).toBe(false); // Wednesday, no hours
    expect([...days].every((d) => d <= "2026-11-09")).toBe(true);
  });

  it("an evening slot stays on the coach's own day", () => {
    const evening = [{ weekday: 2, startTime: "19:00", endTime: "21:00", slotDurationMinutes: 60 }];
    const slots = computePublicSlots({ ...base, windows: evening, days: 1 });
    // 7:00 PM and 8:00 PM New York on Tuesday are 23:00Z and 00:00Z (Wednesday in UTC).
    expect(slots.map((s) => s.dateKey)).toEqual(["2026-10-13", "2026-10-13"]);
    expect(slots[1].startIso).toBe("2026-10-14T00:00:00.000Z");
  });

  it("only offers a time that is actually in the list", () => {
    const slots = computePublicSlots({ ...base, days: 1 });
    expect(slotIsOffered(slots, "2026-10-13T14:00:00.000Z")).toBe(true);
    expect(slotIsOffered(slots, "2026-10-13T14:30:00.000Z")).toBe(false);
    expect(slotIsOffered(slots, "garbage")).toBe(false);
  });
});

describe("changing a booking yourself", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  it("allowed well ahead of the cancellation window", () => {
    expect(guestChangeAllowed(new Date("2026-10-12T12:00:00Z"), now, 24).allowed).toBe(true);
  });
  it("not inside the window", () => {
    const r = guestChangeAllowed(new Date("2026-10-11T06:00:00Z"), now, 24);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/24 hours/);
  });
  it("not after it started", () => {
    expect(guestChangeAllowed(new Date("2026-10-10T11:00:00Z"), now, 0).allowed).toBe(false);
  });
});
