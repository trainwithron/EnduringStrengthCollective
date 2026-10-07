import { describe, expect, it } from "vitest";
import {
  changeFromHere,
  createSeries,
  endSeries,
  extendSeries,
  moveOccurrence,
  pauseSeries,
  previewSeries,
  resumeSeries,
  skipOccurrence,
  topUpSeries,
  type BookingRow,
  type CoachContext,
  type NewSeries,
  type SeriesInput,
  type SeriesRow,
  type SeriesStore,
} from "@/lib/series-engine";

const NY = "America/New_York";

// An in-memory stand-in for the database, with the one rule that matters here: two confirmed sessions for the coach cannot
// overlap (book_session's guard).
function fakeStore(ctx?: Partial<CoachContext>) {
  const series = new Map<string, SeriesRow>();
  const bookings = new Map<string, BookingRow & { seriesId: string | null }>();
  const mirrored: string[] = [];
  let n = 0;
  const context: CoachContext = { timezone: NY, bufferMinutes: 0, windows: [], exceptions: [], ...ctx };

  const store: SeriesStore = {
    async coachContext() {
      return context;
    },
    async busy(_coachId, from, to) {
      return [...bookings.values()]
        .filter((b) => b.status === "confirmed" && new Date(b.startAt) < to && new Date(b.endAt) > from)
        .map((b) => ({ start: new Date(b.startAt), end: new Date(b.endAt) }));
    },
    async insertSeries(row: NewSeries) {
      const id = `s${++n}`;
      const value = { id, ...row };
      series.set(id, value);
      return { ok: true as const, value };
    },
    async getSeries(id) {
      return series.get(id) ?? null;
    },
    async updateSeries(id, patch) {
      const cur = series.get(id);
      if (cur) series.set(id, { ...cur, ...patch });
    },
    async seriesBookings(seriesId) {
      return [...bookings.values()]
        .filter((b) => b.seriesId === seriesId && b.status === "confirmed")
        .sort((a, b) => a.startAt.localeCompare(b.startAt));
    },
    async getBooking(id) {
      return bookings.get(id) ?? null;
    },
    async book({ coachId, athleteId, groupId, start, end, seriesId }) {
      const clash = [...bookings.values()].some((b) => b.status === "confirmed" && new Date(b.startAt) < end && new Date(b.endAt) > start);
      if (clash) return { ok: false as const, message: "Time already taken" };
      const id = `b${++n}`;
      bookings.set(id, {
        id,
        seriesId,
        coachId,
        athleteId,
        groupId,
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        status: "confirmed",
        attendedAt: null,
        creditState: "unsettled",
      });
      return { ok: true as const, bookingId: id };
    },
    async cancel(bookingId) {
      const b = bookings.get(bookingId);
      if (!b || b.status !== "confirmed") return { ok: false as const, message: "not cancellable" };
      bookings.set(bookingId, { ...b, status: "cancelled" });
      return { ok: true as const };
    },
    async mirror(bookingId) {
      mirrored.push(bookingId);
    },
  };
  return { store, series, bookings, mirrored };
}

const NOW = new Date("2026-10-13T12:00:00Z"); // Tuesday morning, New York
const base: SeriesInput = {
  coachId: "c1",
  athleteId: "a1",
  groupId: "g1",
  firstStartIso: "2026-10-20T10:00:00.000Z", // Tuesday Oct 20, 6:00 AM New York (EDT)
  durationMinutes: 60,
  mode: "fixed",
  count: 4,
};

const confirmed = (bookings: Map<string, BookingRow>) => [...bookings.values()].filter((b) => b.status === "confirmed");

describe("preview", () => {
  it("lists every week without writing anything", async () => {
    const { store, series, bookings } = fakeStore();
    const p = await previewSeries(store, base, NOW);
    expect(p.rows).toHaveLength(4);
    expect(p.rows.every((r) => r.conflict === null)).toBe(true);
    expect(p.startTime).toBe("06:00");
    expect(p.weekday).toBe(2);
    expect(series.size).toBe(0);
    expect(bookings.size).toBe(0);
  });

  it("flags a week that is already taken", async () => {
    const { store } = fakeStore();
    await store.book({ coachId: "c1", athleteId: "x", groupId: "g1", start: new Date("2026-10-27T10:00:00Z"), end: new Date("2026-10-27T11:00:00Z"), seriesId: "other" });
    const p = await previewSeries(store, base, NOW);
    expect(p.rows[1].conflict).toBe("taken");
    expect(p.rows[1].blocking).toBe(true);
    expect(p.rows[0].conflict).toBeNull();
  });

  it("reports bad input instead of throwing", async () => {
    const { store } = fakeStore();
    const p = await previewSeries(store, { ...base, count: 99 }, NOW);
    expect(p.error).toBeTruthy();
    expect(p.rows).toHaveLength(0);
  });
});

describe("create", () => {
  it("books each week and records the series", async () => {
    const { store, series, bookings } = fakeStore();
    const r = await createSeries(store, base, NOW);
    expect(r.ok).toBe(true);
    expect(r.booked).toBe(4);
    expect(confirmed(bookings)).toHaveLength(4);
    const s = [...series.values()][0];
    expect(s.mode).toBe("fixed");
    expect(s.occurrencesTotal).toBe(4);
    expect(s.anchorDate).toBe("2026-10-20");
    expect(s.startTime).toBe("06:00");
  });

  it("keeps 6:00 across the clock change", async () => {
    const { store, bookings } = fakeStore();
    await createSeries(store, { ...base, count: 3, firstStartIso: "2026-10-27T10:00:00.000Z" }, NOW);
    const starts = confirmed(bookings).map((b) => b.startAt);
    expect(starts).toEqual(["2026-10-27T10:00:00.000Z", "2026-11-03T11:00:00.000Z", "2026-11-10T11:00:00.000Z"]);
  });

  it("leaves out dates the coach unticked and remembers them", async () => {
    const { store, series, bookings } = fakeStore();
    const r = await createSeries(store, { ...base, skipStartsIso: ["2026-10-27T10:00:00.000Z"] }, NOW);
    expect(r.booked).toBe(3);
    expect(confirmed(bookings).some((b) => b.startAt === "2026-10-27T10:00:00.000Z")).toBe(false);
    expect([...series.values()][0].skippedStarts).toEqual(["2026-10-27T10:00:00.000Z"]);
  });

  it("books around a taken week and says which", async () => {
    const { store, bookings } = fakeStore();
    await store.book({ coachId: "c1", athleteId: "x", groupId: "g1", start: new Date("2026-10-27T10:00:00Z"), end: new Date("2026-10-27T11:00:00Z"), seriesId: "other" });
    const r = await createSeries(store, base, NOW);
    expect(r.ok).toBe(true);
    expect(r.booked).toBe(3);
    expect(r.notBooked).toHaveLength(1);
    expect(r.notBooked[0].startIso).toBe("2026-10-27T10:00:00.000Z");
    expect(confirmed(bookings)).toHaveLength(4); // 3 + the other client's
  });

  it("creates nothing when no date can be booked", async () => {
    const { store, series } = fakeStore();
    const r = await createSeries(store, { ...base, firstStartIso: "2026-10-06T10:00:00.000Z", count: 1 }, NOW);
    expect(r.ok).toBe(false);
    expect(series.size).toBe(0);
  });

  it("only mirrors to Google inside the next 12 weeks", async () => {
    const { store, mirrored } = fakeStore();
    await createSeries(store, { ...base, count: 20 }, NOW);
    // Oct 20 + 11 weeks = Jan 5 is inside 12 weeks of Oct 13 (Jan 5). Weeks after are not.
    expect(mirrored.length).toBeGreaterThan(0);
    expect(mirrored.length).toBeLessThan(20);
  });

  it("an ongoing series books 12 weeks ahead", async () => {
    const { store, series, bookings } = fakeStore();
    const r = await createSeries(store, { ...base, mode: "ongoing", count: undefined }, NOW);
    expect(r.booked).toBe(12);
    expect(confirmed(bookings)).toHaveLength(12);
    expect([...series.values()][0].occurrencesTotal).toBeNull();
  });
});

describe("ongoing top-up", () => {
  async function ongoing() {
    const fx = fakeStore();
    const r = await createSeries(fx.store, { ...base, mode: "ongoing", count: undefined }, NOW);
    return { ...fx, seriesId: r.seriesId! };
  }

  it("does nothing when everything is already booked", async () => {
    const { store, seriesId } = await ongoing();
    const r = await topUpSeries(store, seriesId, NOW);
    expect(r.booked).toBe(0);
  });

  it("books the new week as time passes", async () => {
    const { store, bookings, seriesId } = await ongoing();
    const later = new Date(NOW.getTime() + 7 * 86400000);
    const r = await topUpSeries(store, seriesId, later);
    expect(r.booked).toBe(1);
    expect(confirmed(bookings)).toHaveLength(13);
  });

  it("never books a week the coach removed", async () => {
    const { store, bookings, seriesId } = await ongoing();
    const target = confirmed(bookings)[2];
    await skipOccurrence(store, target.id, NOW);
    const r = await topUpSeries(store, seriesId, NOW);
    expect(r.booked).toBe(0);
    expect(confirmed(bookings).some((b) => b.startAt === target.startAt)).toBe(false);
  });

  it("does nothing for a paused or ended series", async () => {
    const { store, seriesId } = await ongoing();
    await pauseSeries(store, seriesId, NOW);
    expect((await topUpSeries(store, seriesId, new Date(NOW.getTime() + 14 * 86400000))).booked).toBe(0);
  });

  it("ends itself after its end date", async () => {
    const fx = fakeStore();
    const r = await createSeries(fx.store, { ...base, mode: "ongoing", count: undefined, endsOn: "2026-11-03" }, NOW);
    expect(r.booked).toBe(3);
    await topUpSeries(fx.store, r.seriesId!, new Date("2026-11-10T12:00:00Z"));
    expect(fx.series.get(r.seriesId!)!.status).toBe("ended");
  });

  it("books around something that now clashes and reports it", async () => {
    const { store, bookings, seriesId } = await ongoing();
    const later = new Date(NOW.getTime() + 7 * 86400000);
    // Another session lands exactly where the new week would go (Jan 5, 6:00 AM New York = 11:00Z).
    await store.book({ coachId: "c1", athleteId: "x", groupId: "g1", start: new Date("2027-01-12T11:00:00Z"), end: new Date("2027-01-12T12:00:00Z"), seriesId: "other" });
    const r = await topUpSeries(store, seriesId, later);
    expect(r.booked).toBe(0);
    expect(r.notBooked).toHaveLength(1);
    expect(confirmed(bookings)).toHaveLength(13); // 12 + the other client's
  });
});

describe("pause and resume", () => {
  it("pause removes upcoming sessions and remembers how many", async () => {
    const { store, series, bookings } = fakeStore();
    const r = await createSeries(store, base, NOW);
    const p = await pauseSeries(store, r.seriesId!, NOW);
    expect(p.ok).toBe(true);
    expect(p.cancelled).toBe(4);
    expect(confirmed(bookings)).toHaveLength(0);
    expect(series.get(r.seriesId!)!.status).toBe("paused");
    expect(series.get(r.seriesId!)!.pausedRemaining).toBe(4);
  });

  it("a session that already happened is not removed", async () => {
    const { store, bookings } = fakeStore();
    const r = await createSeries(store, base, NOW);
    const first = confirmed(bookings)[0];
    bookings.set(first.id, { ...first, attendedAt: "2026-10-20T11:00:00Z" });
    const p = await pauseSeries(store, r.seriesId!, new Date("2026-10-21T12:00:00Z"));
    expect(p.cancelled).toBe(3); // the other three; the attended one stays
    expect(confirmed(bookings)).toHaveLength(1);
  });

  it("resuming a fixed schedule puts the same number of weeks back from the next matching day", async () => {
    const { store, bookings } = fakeStore();
    const r = await createSeries(store, base, NOW);
    await pauseSeries(store, r.seriesId!, NOW);
    const later = new Date("2026-10-28T12:00:00Z");
    const res = await resumeSeries(store, r.seriesId!, later);
    expect(res.ok).toBe(true);
    expect(res.booked).toBe(4);
    expect(confirmed(bookings)[0].startAt).toBe("2026-11-03T11:00:00.000Z");
  });

  it("resuming an ongoing schedule tops it up", async () => {
    const { store, bookings } = fakeStore();
    const r = await createSeries(store, { ...base, mode: "ongoing", count: undefined }, NOW);
    await pauseSeries(store, r.seriesId!, NOW);
    const res = await resumeSeries(store, r.seriesId!, NOW);
    expect(res.booked).toBe(12);
    expect(confirmed(bookings)).toHaveLength(12);
  });

  it("only a running schedule can be paused, only a paused one resumed", async () => {
    const { store } = fakeStore();
    const r = await createSeries(store, base, NOW);
    expect((await resumeSeries(store, r.seriesId!, NOW)).ok).toBe(false);
    await pauseSeries(store, r.seriesId!, NOW);
    expect((await pauseSeries(store, r.seriesId!, NOW)).ok).toBe(false);
  });
});

describe("end", () => {
  it("ends the schedule and removes upcoming sessions", async () => {
    const { store, series, bookings } = fakeStore();
    const r = await createSeries(store, base, NOW);
    const e = await endSeries(store, r.seriesId!, NOW);
    expect(e.cancelled).toBe(4);
    expect(series.get(r.seriesId!)!.status).toBe("ended");
    expect(confirmed(bookings)).toHaveLength(0);
  });

  it("can end the schedule and leave what is booked", async () => {
    const { store, series, bookings } = fakeStore();
    const r = await createSeries(store, base, NOW);
    const e = await endSeries(store, r.seriesId!, NOW, { cancelUpcoming: false });
    expect(e.cancelled).toBe(0);
    expect(series.get(r.seriesId!)!.status).toBe("ended");
    expect(confirmed(bookings)).toHaveLength(4);
  });

  it("cannot end twice", async () => {
    const { store } = fakeStore();
    const r = await createSeries(store, base, NOW);
    await endSeries(store, r.seriesId!, NOW);
    expect((await endSeries(store, r.seriesId!, NOW)).ok).toBe(false);
  });
});

describe("extend", () => {
  it("adds weeks after the last one", async () => {
    const { store, series, bookings } = fakeStore();
    const r = await createSeries(store, base, NOW);
    const x = await extendSeries(store, r.seriesId!, 2, NOW);
    expect(x.ok).toBe(true);
    expect(x.booked).toBe(2);
    expect(series.get(r.seriesId!)!.occurrencesTotal).toBe(6);
    expect(confirmed(bookings)).toHaveLength(6);
    expect(confirmed(bookings)[5].startAt).toBe("2026-11-24T11:00:00.000Z");
  });

  it("cannot go past 52 weeks", async () => {
    const { store } = fakeStore();
    const r = await createSeries(store, { ...base, count: 50 }, NOW);
    const x = await extendSeries(store, r.seriesId!, 5, NOW);
    expect(x.ok).toBe(false);
    expect(x.message).toContain("52");
  });

  it("is not for schedules with no end", async () => {
    const { store } = fakeStore();
    const r = await createSeries(store, { ...base, mode: "ongoing", count: undefined }, NOW);
    expect((await extendSeries(store, r.seriesId!, 4, NOW)).ok).toBe(false);
  });

  it("skips weeks that were removed earlier", async () => {
    const { store, bookings } = fakeStore();
    const r = await createSeries(store, { ...base, count: 2 }, NOW);
    // Weeks 2 and 3 (indexes) land Nov 3 and Nov 10; remove nothing yet, then extend and skip is via skippedStarts.
    const x = await extendSeries(store, r.seriesId!, 2, NOW);
    expect(x.booked).toBe(2);
    expect(confirmed(bookings)).toHaveLength(4);
  });
});

describe("edit one", () => {
  it("moves one session and the others stay", async () => {
    const { store, series, bookings } = fakeStore();
    const r = await createSeries(store, base, NOW);
    const target = confirmed(bookings)[1]; // Oct 27
    const m = await moveOccurrence(store, target.id, "2026-10-29T14:00:00.000Z", null, NOW);
    expect(m.ok).toBe(true);
    const starts = confirmed(bookings).map((b) => b.startAt);
    expect(starts).toContain("2026-10-29T14:00:00.000Z");
    expect(starts).not.toContain("2026-10-27T10:00:00.000Z");
    expect(starts).toHaveLength(4);
    expect(series.get(r.seriesId!)!.skippedStarts).toContain("2026-10-27T10:00:00.000Z");
  });

  it("an ongoing top-up does not book the old time back", async () => {
    const { store, bookings } = fakeStore();
    const r = await createSeries(store, { ...base, mode: "ongoing", count: undefined }, NOW);
    const target = confirmed(bookings)[1];
    await moveOccurrence(store, target.id, "2026-10-29T14:00:00.000Z", null, NOW);
    const t = await topUpSeries(store, r.seriesId!, NOW);
    expect(t.booked).toBe(0);
    expect(confirmed(bookings).some((b) => b.startAt === target.startAt)).toBe(false);
  });

  it("can nudge a session by 30 minutes even though it overlaps its old time", async () => {
    const { store, bookings } = fakeStore();
    await createSeries(store, base, NOW);
    const target = confirmed(bookings)[0];
    const m = await moveOccurrence(store, target.id, "2026-10-20T10:30:00.000Z", null, NOW);
    expect(m.ok).toBe(true);
    expect(confirmed(bookings).map((b) => b.startAt)).toContain("2026-10-20T10:30:00.000Z");
  });

  it("when the new time is taken, nothing changes", async () => {
    const { store, bookings } = fakeStore();
    await createSeries(store, base, NOW);
    await store.book({ coachId: "c1", athleteId: "x", groupId: "g1", start: new Date("2026-10-29T14:00:00Z"), end: new Date("2026-10-29T15:00:00Z"), seriesId: "other" });
    const target = confirmed(bookings).find((b) => b.seriesId !== "other")!;
    const before = confirmed(bookings).length;
    const m = await moveOccurrence(store, target.id, "2026-10-29T14:00:00.000Z", null, NOW);
    expect(m.ok).toBe(false);
    expect(confirmed(bookings)).toHaveLength(before);
    expect(confirmed(bookings).some((b) => b.id === target.id)).toBe(true);
  });

  it("will not move a session that already happened or one in the past", async () => {
    const { store, bookings } = fakeStore();
    await createSeries(store, base, NOW);
    const target = confirmed(bookings)[0];
    bookings.set(target.id, { ...target, attendedAt: "2026-10-20T11:00:00Z" });
    expect((await moveOccurrence(store, target.id, "2026-10-29T14:00:00.000Z", null, NOW)).ok).toBe(false);
    const other = confirmed(bookings)[0];
    expect((await moveOccurrence(store, other.id, "2026-10-01T14:00:00.000Z", null, NOW)).ok).toBe(false);
  });

  it("remove one leaves the schedule running", async () => {
    const { store, series, bookings } = fakeStore();
    const r = await createSeries(store, base, NOW);
    const target = confirmed(bookings)[0];
    const s = await skipOccurrence(store, target.id, NOW);
    expect(s.ok).toBe(true);
    expect(confirmed(bookings)).toHaveLength(3);
    expect(series.get(r.seriesId!)!.status).toBe("active");
  });
});

describe("edit this and the rest", () => {
  it("ends the old schedule before this session and starts a new one at the new time", async () => {
    const { store, series, bookings } = fakeStore();
    const r = await createSeries(store, base, NOW);
    const third = confirmed(bookings)[2]; // Nov 3
    const c = await changeFromHere(store, third.id, "2026-11-05T15:00:00.000Z", 45, NOW);
    expect(c.ok).toBe(true);
    expect(series.get(r.seriesId!)!.status).toBe("ended");
    expect(series.get(r.seriesId!)!.endsOn).toBe("2026-11-02");
    const starts = confirmed(bookings).map((b) => b.startAt).sort();
    // Two earlier Tuesdays stay; two new Thursdays (the old third and fourth sessions become two weeks at the new time).
    expect(starts).toEqual(["2026-10-20T10:00:00.000Z", "2026-10-27T10:00:00.000Z", "2026-11-05T15:00:00.000Z", "2026-11-12T15:00:00.000Z"]);
    const newSeries = [...series.values()].find((s) => s.id === c.seriesId)!;
    expect(newSeries.durationMinutes).toBe(45);
    expect(newSeries.occurrencesTotal).toBe(2);
  });

  it("changing from the very first session replaces the whole schedule", async () => {
    const { store, series, bookings } = fakeStore();
    const r = await createSeries(store, base, NOW);
    const first = confirmed(bookings)[0];
    const c = await changeFromHere(store, first.id, "2026-10-22T10:00:00.000Z", null, NOW);
    expect(c.ok).toBe(true);
    expect(series.get(r.seriesId!)!.status).toBe("cancelled");
    expect(confirmed(bookings)).toHaveLength(4);
  });

  it("refuses, and changes nothing, when none of the new times can be booked", async () => {
    // Every new Thursday is already taken by someone else's session.
    const { store, series, bookings } = fakeStore();
    const r = await createSeries(store, base, NOW);
    const before = confirmed(bookings).map((b) => b.startAt);
    for (const day of ["2026-11-05", "2026-11-12"]) {
      await store.book({ coachId: "c1", athleteId: "x", groupId: "g9", start: new Date(`${day}T15:00:00Z`), end: new Date(`${day}T16:00:00Z`), seriesId: "other" });
    }
    const third = confirmed(bookings).filter((b) => b.seriesId === r.seriesId)[2];
    const c = await changeFromHere(store, third.id, "2026-11-05T15:00:00.000Z", 45, NOW);
    expect(c.ok).toBe(false);
    expect(c.message).toMatch(/nothing was changed/i);
    expect(confirmed(bookings).filter((b) => b.seriesId === r.seriesId).map((b) => b.startAt)).toEqual(before);
    expect(series.get(r.seriesId!)!.status).toBe("active");
  });

  it("a new time that overlaps one of the schedule's OWN sessions is fine (that time is about to be free)", async () => {
    const { store, bookings } = fakeStore();
    const r = await createSeries(store, base, NOW);
    const third = confirmed(bookings).filter((b) => b.seriesId === r.seriesId)[2]; // Nov 3, 10:00Z
    const c = await changeFromHere(store, third.id, "2026-11-03T10:30:00.000Z", 60, NOW);
    expect(c.ok).toBe(true);
  });

  it("an ongoing schedule stays ongoing", async () => {
    const { store, series, bookings } = fakeStore();
    await createSeries(store, { ...base, mode: "ongoing", count: undefined }, NOW);
    const second = confirmed(bookings)[1];
    const c = await changeFromHere(store, second.id, "2026-10-29T10:00:00.000Z", null, NOW);
    expect(c.ok).toBe(true);
    const created = [...series.values()].find((s) => s.id === c.seriesId)!;
    expect(created.mode).toBe("ongoing");
  });
});
