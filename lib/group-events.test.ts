import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { answerLabel, eventAnswer, eventPostBody, eventProblem, friendlyEventError } from "@/lib/group-events";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");
const now = new Date("2026-10-10T12:00:00Z");
const future = "2026-10-17T14:00:00Z";

describe("a member's answer to an event", () => {
  it("In, Out, waiting, there and no answer are different things", () => {
    expect(eventAnswer("joined")).toBe("in");
    expect(eventAnswer("cancelled")).toBe("out");
    expect(eventAnswer("waitlisted")).toBe("waiting");
    expect(eventAnswer("attended")).toBe("there");
    expect(eventAnswer(null)).toBe("none");
    expect(eventAnswer(undefined)).toBe("none");
    const labels = new Set(["in", "out", "waiting", "there", "none"].map((a) => answerLabel(a as never)));
    expect(labels.size).toBe(5);
  });
});

describe("a new event", () => {
  const ok = { title: "Gym then lunch", startIso: future, durationMinutes: 120 };
  it("accepts a plain event, with or without spots", () => {
    expect(eventProblem(ok, now)).toBeNull();
    expect(eventProblem({ ...ok, capacity: null }, now)).toBeNull();
    expect(eventProblem({ ...ok, capacity: 0 }, now)).toBeNull();
    expect(eventProblem({ ...ok, capacity: 12, place: "The gym", note: "Bring water" }, now)).toBeNull();
  });
  it("says plainly what is wrong", () => {
    expect(eventProblem({ ...ok, title: " " }, now)).toMatch(/name/);
    expect(eventProblem({ ...ok, startIso: "nope" }, now)).toMatch(/date and time/);
    expect(eventProblem({ ...ok, startIso: "2026-10-01T00:00:00Z" }, now)).toMatch(/future/);
    expect(eventProblem({ ...ok, durationMinutes: 1 }, now)).toMatch(/length/);
    expect(eventProblem({ ...ok, capacity: 99 }, now)).toMatch(/Spots/);
    expect(eventProblem({ ...ok, place: "x".repeat(201) }, now)).toMatch(/place/);
    expect(eventProblem({ ...ok, note: "x".repeat(501) }, now)).toMatch(/note/);
  });
  it("the feed announcement asks In or out, once, with the place when there is one", () => {
    expect(eventPostBody({ coachName: "Ron", title: "Gym then lunch", when: "Sat, Oct 17, 9:00 AM", place: "The gym" })).toBe("Ron scheduled Gym then lunch for Sat, Oct 17, 9:00 AM at The gym. Are you in or out?");
    expect(eventPostBody({ coachName: "Ron", title: "Run", when: "Sat", place: null })).toBe("Ron scheduled Run for Sat. Are you in or out?");
  });
  it("database refusals become plain sentences", () => {
    expect(friendlyEventError("that time is already taken")).toMatch(/already have something/);
    expect(friendlyEventError("this event was cancelled")).toMatch(/cancelled/);
    expect(friendlyEventError("weird internal thing")).toBe("That didn't work. Try again.");
  });
});

describe("events never touch a credit, anywhere in the app code or the migration", () => {
  const migration = read("supabase/migrations/0323_group_events.sql");
  const eventFns = migration.slice(migration.indexOf("-- ---- the event's own functions"), migration.indexOf("revoke all on function public.create_group_event"));

  it("none of the event functions calls a credit function or the balance table", () => {
    expect(eventFns).not.toMatch(/apply_session_credit_change|adjust_session_credits|session_credits|session_credit_ledger|grant_session_credits|settle_booking/);
    expect(eventFns).toContain("create or replace function public.join_group_event");
    expect(eventFns).toContain("create or replace function public.leave_group_event");
    expect(eventFns).toContain("create or replace function public.cancel_group_event");
    expect(eventFns).toContain("create or replace function public.mark_group_event_attendee");
  });
  it("every class function that moves a credit refuses an event first", () => {
    for (const fn of ["join_group_session", "leave_group_session", "set_group_session_capacity", "cancel_group_session", "mark_group_attendee"]) {
      const start = migration.indexOf(`create or replace function public.${fn}(`);
      const body = migration.slice(start, migration.indexOf("$$;", migration.indexOf("as $$", start)));
      expect(body, fn).toContain("if s.kind = 'event' then raise exception 'this is a group event, not a class'; end if;");
    }
    const promote = migration.slice(migration.indexOf("create or replace function public.promote_group_waitlist("));
    expect(promote.slice(0, promote.indexOf("$$;", promote.indexOf("as $$")))).toContain("or s.kind = 'event' then");
  });
  it("the routes only call the event functions, never the class ones", () => {
    const create = read("app/api/group-events/route.ts");
    const act = read("app/api/group-events/[eventId]/route.ts");
    for (const src of [create, act]) expect(src).not.toMatch(/join_group_session|leave_group_session|cancel_group_session|mark_group_attendee|adjust_session_credits|apply_session_credit_change/);
    expect(act).toContain('"join_group_event"');
    expect(act).toContain('"leave_group_event"');
    expect(act).toContain('"cancel_group_event"');
    expect(act).toContain('"mark_group_event_attendee"');
  });
  it("one announcement post and one push per member when an event is created", () => {
    const create = read("app/api/group-events/route.ts");
    expect(create.match(/from\("posts"\)\.insert/g)?.length).toBe(1);
    expect(create).toContain('channel: "announcements"');
    expect(create).toContain("group_session_id: eventId");
    expect(create.match(/sendPushToProfile\(/g)?.length).toBe(1);
  });
  it("the class lists only show classes", () => {
    for (const f of ["app/(coach)/groups/[groupId]/classes/page.tsx", "app/(coach)/groups/[groupId]/group-sessions/page.tsx", "app/(coach)/dashboard/page.tsx", "app/(coach)/groups/[groupId]/page.tsx"]) {
      expect(read(f), f).toContain('.eq("kind", "class")');
    }
  });
});
