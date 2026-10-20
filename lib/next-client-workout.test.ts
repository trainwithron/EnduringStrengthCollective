import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }) }));
vi.mock("@/lib/supabase/client", () => ({ createBrowserClient: () => ({}) }));
const programs = vi.hoisted(() => ({ list: [{ id: "p1" }] as { id: string }[] }));
vi.mock("@/lib/active-programs", () => ({ getActivePrograms: async () => programs.list }));

import { sessionWhenInWords } from "@/lib/session-when-words";
import { nextClientSessionToday } from "@/lib/next-session-order";
import { loadNextClientToday } from "@/components/coach/next-client-workout-section";
import { SessionCheckCards } from "@/components/coach/session-check-cards";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const LA = "America/Los_Angeles";
// Monday Oct 19, 2026, 7:58 AM Pacific (PDT).
const NOW = new Date("2026-10-19T14:58:00Z");

// Ron, Oct 19: Johann's card (Thu Oct 15, 8:00 AM) read as today's 8:00 session.
describe("a card names when the session was, in words", () => {
  it("last Thursday for a session four days back, with the exact date after", () => {
    expect(sessionWhenInWords("2026-10-15T15:00:00Z", LA, NOW)).toBe("last Thursday (Oct 15, 8:00 AM)");
  });
  it("today, morning / afternoon / evening", () => {
    expect(sessionWhenInWords("2026-10-19T13:00:00Z", LA, NOW)).toBe("this morning (6:00 AM)");
    expect(sessionWhenInWords("2026-10-19T14:30:00Z", LA, new Date("2026-10-19T23:00:00Z"))).toBe("this morning (7:30 AM)");
    expect(sessionWhenInWords("2026-10-19T21:00:00Z", LA, new Date("2026-10-20T01:30:00Z"))).toBe("this afternoon (2:00 PM)");
    expect(sessionWhenInWords("2026-10-20T01:00:00Z", LA, new Date("2026-10-20T05:00:00Z"))).toBe("this evening (6:00 PM)");
  });
  it("yesterday", () => {
    expect(sessionWhenInWords("2026-10-18T15:00:00Z", LA, NOW)).toBe("yesterday (Oct 18, 8:00 AM)");
  });
  it("two to six days back says 'last <weekday>'; a week or more says 'on <weekday, date>'", () => {
    expect(sessionWhenInWords("2026-10-17T16:00:00Z", LA, NOW)).toBe("last Saturday (Oct 17, 9:00 AM)");
    expect(sessionWhenInWords("2026-10-13T16:00:00Z", LA, NOW)).toBe("last Tuesday (Oct 13, 9:00 AM)");
    expect(sessionWhenInWords("2026-10-12T17:00:00Z", LA, NOW)).toBe("on Mon, Oct 12 (10:00 AM)");
    expect(sessionWhenInWords("2026-10-08T15:00:00Z", LA, NOW)).toBe("on Thu, Oct 8 (8:00 AM)");
  });
  it("uses the coach's day, not UTC's (a 9 PM Sunday session is last night, not today, on Monday morning)", () => {
    expect(sessionWhenInWords("2026-10-19T04:00:00Z", LA, NOW)).toBe("yesterday (Oct 18, 9:00 PM)");
  });
  it("the card says it in a sentence that cannot be read as today", () => {
    const sessions = [{ bookingId: "b1", athleteId: "a1", groupId: "g", name: "Johann G.", startIso: "2026-10-15T15:00:00Z" }];
    const html = renderToStaticMarkup(createElement(SessionCheckCards, { sessions, timezone: LA }));
    expect(html.replace(/<!-- -->/g, "")).toContain("s session last Thursday (Oct 15, 8:00 AM) happen?");
    expect(html).toContain(">Yes<");
    expect(html).toContain(">No<");
    expect(html).toContain(">Reschedule<");
  });
});

describe("the next client today", () => {
  const rows = [
    { start_at: "2026-10-19T13:00:00Z", name: "Oliver 6 AM (already past)" },
    { start_at: "2026-10-19T14:40:00Z", name: "Began 7:40 (18 min ago)" },
    { start_at: "2026-10-19T15:00:00Z", name: "Johann 8 AM" },
    { start_at: "2026-10-19T16:00:00Z", name: "Cindie 9 AM" },
    { start_at: "2026-10-20T15:00:00Z", name: "Tomorrow" },
  ];
  it("a session begun in the last 30 minutes still counts, and comes first", () => {
    expect(nextClientSessionToday(rows, LA, NOW)?.name).toBe("Began 7:40 (18 min ago)");
  });
  it("otherwise the soonest one still ahead today: at 7:58 it is the 8:00", () => {
    expect(nextClientSessionToday(rows.filter((r) => !r.name.startsWith("Began")), LA, NOW)?.name).toBe("Johann 8 AM");
  });
  it("one that began more than 30 minutes ago does not count, and tomorrow's never does", () => {
    expect(nextClientSessionToday([rows[0], rows[4]], LA, NOW)).toBeNull();
    expect(nextClientSessionToday([], LA, NOW)).toBeNull();
  });
  it("'today' is the coach's day: at 6 PM Pacific a 7 PM session is next, a 9 AM one tomorrow morning is not", () => {
    const evening = new Date("2026-10-20T01:00:00Z");
    const list = [{ start_at: "2026-10-20T02:00:00Z", name: "7 PM" }, { start_at: "2026-10-20T16:00:00Z", name: "tomorrow 9 AM" }];
    expect(nextClientSessionToday(list, LA, evening)?.name).toBe("7 PM");
    expect(nextClientSessionToday([list[1]], LA, evening)).toBeNull();
  });
});

describe("the Home button reads only what it should and goes where 'Log their workout' goes", () => {
  function fakeSupabase(bookings: { id: string; athlete_id: string; group_id: string; start_at: string }[], hasProgram: boolean) {
    programs.list = hasProgram ? [{ id: "p1" }] : [];
    const calls: string[] = [];
    const bookingChain: any = {
      select: () => bookingChain,
      eq: (c: string, v: unknown) => (calls.push(`${c}=${String(v)}`), bookingChain),
      in: (c: string) => (calls.push(`${c} in`), bookingChain),
      is: (c: string) => (calls.push(`${c} is null`), bookingChain),
      gte: (c: string) => (calls.push(`${c}>=`), bookingChain),
      lt: (c: string) => (calls.push(`${c}<`), bookingChain),
      order: () => bookingChain,
      range: async () => ({ data: bookings, error: null }),
    };
    const profileChain: any = { select: () => profileChain, eq: () => profileChain, maybeSingle: async () => ({ data: { full_name: "Johann Gorsek" }, error: null }) };
    return { calls, from: (t: string) => (t === "bookings" ? bookingChain : profileChain) };
  }
  it("this coach's confirmed, un-marked sessions in the open organization's groups, today, no tomorrow", async () => {
    const sb = fakeSupabase([{ id: "b1", athlete_id: "johann", group_id: "g1", start_at: "2026-10-19T15:00:00Z" }], true);
    const out = await loadNextClientToday(sb, "coach", ["g1"], LA, NOW);
    expect(out?.name).toBe("Johann G.");
    expect(out?.athleteId).toBe("johann");
    expect(out?.hasProgram).toBe(true);
    expect(sb.calls).toEqual(expect.arrayContaining(["coach_id=coach", "group_id in", "status=confirmed", "attended_at is null", "no_show=false", "start_at>=", "start_at<"]));
  });
  it("a next client with no program is flagged, so the button opens their profile with the plain line", async () => {
    const out = await loadNextClientToday(fakeSupabase([{ id: "b1", athlete_id: "johann", group_id: "g1", start_at: "2026-10-19T15:00:00Z" }], false), "coach", ["g1"], LA, NOW);
    expect(out?.hasProgram).toBe(false);
  });
  it("nothing left today means no button", async () => {
    expect(await loadNextClientToday(fakeSupabase([], true), "coach", ["g1"], LA, NOW)).toBeNull();
  });
  it("the coach's own booking is never offered as a client", async () => {
    expect(await loadNextClientToday(fakeSupabase([{ id: "b1", athlete_id: "coach", group_id: "g1", start_at: "2026-10-19T15:00:00Z" }], true), "coach", ["g1"], LA, NOW)).toBeNull();
  });
  it("source: the button goes to the client's log page, or to their profile with a plain line when there is no program", () => {
    const src = read("components/coach/next-client-workout-section.tsx");
    expect(src).toContain("/log` : `/groups/${next.groupId}/athletes/${next.athleteId}`");
    // the short name already ends with a period ("Cindie D."): none is added
    expect(src).toContain("No program yet for {next.name}</p>");
    expect(src).not.toContain("No program yet for {next.name}.");
    expect(src).toContain("Start {next.name}&apos;s workout");
    expect(src).toContain("nextSessionLabel(next.startIso, timezone, now)");
  });
  it("it sits directly under the 'Did X's session happen?' cards on the computer Home and the phone Home", () => {
    const desktop = read("app/(coach)/dashboard/page.tsx");
    expect(desktop.indexOf("<NextClientWorkoutSection")).toBeGreaterThan(desktop.indexOf("<SessionCheckSection"));
    expect(desktop.indexOf("<NextClientWorkoutSection")).toBeLessThan(desktop.indexOf("<YourDayPanel"));
    // on a phone it is at the top of Spotlight, under the did-it-happen cards (Release 2)
    const phone = read("components/coach/mobile/spot-needs-top.tsx");
    expect(phone.indexOf("Start {needs.next.name}")).toBeGreaterThan(phone.indexOf("<SessionCheckCards"));
    expect(read("components/coach/next-client-workout-section.tsx")).toContain("No sessions left today.");
    expect(phone).not.toContain("Start workout");
  });
});

// Oct 19 audit: after "Pause for now" nothing on Home said a client's workout was waiting; Home still said "Start".
describe("a coach-logged workout left open or paused in the last 36 hours", () => {
  function fakeOpen(rows: { id: string; athlete_id: string; group_id: string; started_at: string }[]) {
    const calls: string[] = [];
    const chain: any = {
      select: () => chain,
      in: (c: string) => (calls.push(`${c} in`), chain),
      eq: (c: string, v: unknown) => (calls.push(`${c}=${String(v)}`), chain),
      gte: (c: string) => (calls.push(`${c}>=`), chain),
      order: () => chain,
      range: async () => ({ data: rows, error: null }),
      maybeSingle: async () => ({ data: { full_name: "Jaxson Kremer" }, error: null }),
    };
    return { calls, from: () => chain };
  }
  it("is found for the newest open one, named, with the session to open", async () => {
    const { loadOpenClientWorkout } = await import("@/components/coach/next-client-workout-section");
    const sb = fakeOpen([
      { id: "old", athlete_id: "a1", group_id: "g1", started_at: "2026-10-18T20:00:00Z" },
      { id: "new", athlete_id: "a2", group_id: "g1", started_at: "2026-10-19T14:00:00Z" },
    ]);
    const open = await loadOpenClientWorkout(sb, ["g1"], NOW);
    expect(open).toMatchObject({ sessionId: "new", athleteId: "a2", name: "Jaxson K." });
    expect(sb.calls).toEqual(expect.arrayContaining(["group_id in", "logged_by_coach=true", "status in", "started_at>="]));
  });
  it("none open means nothing", async () => {
    const { loadOpenClientWorkout } = await import("@/components/coach/next-client-workout-section");
    expect(await loadOpenClientWorkout(fakeOpen([]), ["g1"], NOW)).toBeNull();
  });
  it("Home says 'Resume <name>'s workout' and opens the session where it stopped; the next client's button is not repeated for the same person", () => {
    const src = read("components/coach/next-client-workout-section.tsx");
    expect(src).toContain("Resume {open.name}&apos;s workout");
    expect(src).toContain("/sessions/${open.sessionId}?resume=1");
    expect(src).toContain("const showNext = next && next.athleteId !== open?.athleteId;");
    expect(src).toContain("OPEN_WORKOUT_HOURS = 36");
  });
});
