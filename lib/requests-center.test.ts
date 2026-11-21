import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  answeredBooking,
  answeredClient,
  answeredLate,
  answeredSchedule,
  closestByTime,
  parseFocus,
  requestAnchor,
  requestHref,
  sortAnswered,
} from "@/lib/requests-center";
import { answerableNotices, requestForNotice } from "@/lib/requests-center-server";
import { bookingRequestLine, requestPushLine, scheduleRequestLine, shortName } from "@/lib/notification-push";

// The Requests page and the request pushes (Ron, Nov 19: a session-request push "leads me to nothing", and there was no place to find requests again).
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const TZ = "America/New_York";
const U1 = "11111111-1111-4111-8111-111111111111";

describe("one request, wherever it is", () => {
  it("has one anchor and one link", () => {
    expect(requestAnchor("booking", "b1")).toBe("request-booking-b1");
    expect(requestHref("late", U1)).toBe(`/requests?focus=late:${U1}`);
    expect(parseFocus(`schedule:${U1}`)).toEqual({ kind: "schedule", id: U1 });
    expect(parseFocus("schedule:not-an-id")).toBeNull();
    expect(parseFocus(`payment:${U1}`)).toBeNull();
    expect(parseFocus(undefined)).toBeNull();
  });
  it("every list the coach answers in marks its rows with it (Home's panels, the schedule card, the client requests, the answered list)", () => {
    expect(read("components/coach/late-changes-panel.tsx")).toContain('id={requestAnchor("booking", m.id)}');
    expect(read("components/coach/late-changes-panel.tsx")).toContain('id={requestAnchor("late", i.id)}');
    expect(read("components/coach/schedule-requests-panel.tsx")).toContain('id={requestAnchor("schedule", data.id)}');
    expect(read("components/coach/client-requests-panel.tsx")).toContain('id={requestAnchor("client", r.id)}');
    expect(read("components/coach/requests-center.tsx")).toContain("id={requestAnchor(a.kind, a.id)}");
  });
});

describe("what was answered, in plain words", () => {
  it("a session: what was asked and what was decided", () => {
    const a = answeredBooking(
      { id: "b1", kind: "new", status: "confirmed", from_start_at: null, new_start_at: "2026-11-19T14:00:00Z", decided_at: "2026-11-18T20:00:00Z", created_at: "2026-11-18T19:00:00Z", profiles: { full_name: "Hewan Belete" } },
      TZ
    );
    expect(a).toMatchObject({ who: "Hewan Belete", what: "New session Thu, Nov 19, 9:00 AM", outcome: "Confirmed", decidedAt: "2026-11-18T20:00:00Z" });
    const lapsed = answeredBooking({ id: "b2", kind: "move", status: "pending", from_start_at: "2026-11-10T14:00:00Z", new_start_at: "2026-11-11T14:00:00Z", decided_at: null, created_at: "2026-11-09T00:00:00Z" }, TZ);
    expect(lapsed.outcome).toBe("Not answered: the time passed");
    expect(lapsed.what).toContain("Move Tue, Nov 10");
    expect(lapsed.who).toBe("A client");
  });
  it("a late change, a schedule change and a request to train", () => {
    expect(answeredLate({ id: "k1", start_at: "2026-11-19T14:00:00Z", late_change_kind: "cancel", late_charge_state: "waived" }, TZ)).toMatchObject({ outcome: "Waived", what: "Cancelled late: Thu, Nov 19, 9:00 AM" });
    const s = answeredSchedule({
      id: "s1",
      kind: "freeze",
      status: "applied",
      effective_on: "2026-11-24",
      resume_on: "2026-12-15",
      applied_at: "2026-11-24T12:00:00Z",
      applied_early: false,
      dismissed_at: null,
      withdrawn_at: null,
      created_at: "2026-11-10T12:00:00Z",
      recurring_booking_series: { weekday: 2, start_time: "06:00:00", duration_minutes: 60 },
    });
    expect(s).toMatchObject({ outcome: "Applied", decidedAt: "2026-11-24T12:00:00Z", what: "Freeze Tuesdays at 6:00 AM, 60 minutes until Dec 15, after Nov 24" });
    expect(answeredSchedule({ ...({} as any), id: "s2", kind: "pause", status: "withdrawn", effective_on: "2026-11-24", resume_on: null, applied_at: null, dismissed_at: null, withdrawn_at: "2026-11-20T00:00:00Z", created_at: "x" }).outcome).toBe("Withdrawn by the client");
    expect(answeredClient({ id: "c1", display_name: "Hewan B.", status: "approved", created_at: "2026-11-01T00:00:00Z", decided_at: "2026-11-02T00:00:00Z" }, "Gym A")).toMatchObject({ outcome: "Approved: now your client", orgName: "Gym A" });
  });
  it("newest decision first, each request once", () => {
    const rows = sortAnswered([
      { kind: "booking", id: "1", who: "", what: "", outcome: "", decidedAt: null, sortAt: "2026-11-01" },
      { kind: "late", id: "2", who: "", what: "", outcome: "", decidedAt: null, sortAt: "2026-11-05" },
      { kind: "booking", id: "1", who: "", what: "", outcome: "", decidedAt: null, sortAt: "2026-11-01" },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["2", "1"]);
  });
  it("the closest request in time wins", () => {
    expect(closestByTime([{ id: "a", created_at: "2026-11-19T10:00:02Z" }, { id: "b", created_at: "2026-11-19T10:00:00.1Z" }], "2026-11-19T10:00:00Z")?.id).toBe("b");
    expect(closestByTime([], "2026-11-19T10:00:00Z")).toBeNull();
  });
});

// a tiny stand-in for the database client: answers each table from a list, applying eq/gte/lte
function fakeDb(tables: Record<string, any[]>) {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] === v)), q),
        gte: (c: string, v: string) => ((rows = rows.filter((r) => r[c] >= v)), q),
        lte: (c: string, v: string) => ((rows = rows.filter((r) => r[c] <= v)), q),
        not: () => ((rows = rows.filter((r) => r.late_charge_state != null)), q),
        order: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then: (res: (v: { data: any[]; error: null }) => unknown) => Promise.resolve({ data: rows, error: null }).then(res),
      };
      return q;
    },
  } as any;
}

describe("the request a notice is about", () => {
  const N = "22222222-2222-4222-8222-222222222222";
  it("a session request: the coach's own, in that group, written in the same moment", async () => {
    const db = fakeDb({
      notifications: [{ id: N, profile_id: "coach", type: "booking_request", group_id: "g1", created_at: "2026-11-18T19:00:00.000Z" }],
      booking_requests: [
        { id: "other", coach_id: "coach", group_id: "g1", created_at: "2026-11-18T18:00:00.000Z" },
        { id: "it", coach_id: "coach", group_id: "g1", created_at: "2026-11-18T19:00:00.000Z" },
        { id: "not-mine", coach_id: "someone", group_id: "g1", created_at: "2026-11-18T19:00:00.000Z" },
      ],
    });
    expect(await requestForNotice(db, "coach", N)).toEqual({ kind: "booking", id: "it" });
  });
  it("someone else's notice, or one that is no request, finds nothing", async () => {
    const db = fakeDb({ notifications: [{ id: N, profile_id: "coach", type: "program_assigned", group_id: "g1", created_at: "2026-11-18T19:00:00.000Z" }] });
    expect(await requestForNotice(db, "coach", N)).toBeNull();
    expect(await requestForNotice(db, "intruder", N)).toBeNull();
    expect(await requestForNotice(db, "coach", "not-a-uuid")).toBeNull();
  });
  it("a schedule change applied on its day: found by when it was applied", async () => {
    const db = fakeDb({
      notifications: [{ id: N, profile_id: "coach", type: "schedule_applied", group_id: "g1", created_at: "2026-11-24T12:00:00.000Z" }],
      schedule_requests: [{ id: "s1", group_id: "g1", applied_at: "2026-11-24T12:00:00.000Z", created_at: "2026-11-01T00:00:00.000Z" }],
    });
    expect(await requestForNotice(db, "coach", N)).toEqual({ kind: "schedule", id: "s1" });
  });
});

describe("buttons on a notifications row answer that row's own request", () => {
  // Assistant review of 107b0fbe: matching among WAITING requests only gave an old notice (its request answered) the buttons of another client's request made a moment later.
  const at = "2026-11-18T19:00:00.000Z";
  const later = "2026-11-18T19:00:02.000Z";
  const db = () =>
    fakeDb({
      booking_requests: [
        { id: "a-answered", coach_id: "coach", group_id: "gA", created_at: at, status: "confirmed", new_start_at: "2026-11-30T14:00:00Z" },
        { id: "b-waiting", coach_id: "coach", group_id: "gB", created_at: later, status: "pending", new_start_at: "2026-11-30T15:00:00Z" },
        { id: "c-past", coach_id: "coach", group_id: "gC", created_at: at, status: "pending", new_start_at: "2026-11-01T15:00:00Z" },
      ],
    });
  const now = new Date("2026-11-19T00:00:00Z");
  it("an answered request's notice gets no buttons, even with another client's request a second later", async () => {
    const out = await answerableNotices(db(), "coach", [{ id: "nA", type: "booking_request", created_at: at, group_id: "gA" }], now);
    expect(out.has("nA")).toBe(false);
  });
  it("a waiting request's own notice gets them; one whose time has passed does not", async () => {
    const out = await answerableNotices(
      db(),
      "coach",
      [
        { id: "nB", type: "booking_request", created_at: later, group_id: "gB" },
        { id: "nC", type: "booking_request", created_at: at, group_id: "gC" },
      ],
      now
    );
    expect(out.get("nB")).toEqual({ kind: "booking", requestId: "b-waiting" });
    expect(out.has("nC")).toBe(false);
  });
  it("the push names the client written with the notice, not one a second later", async () => {
    const two = fakeDb({
      booking_requests: [
        { coach_id: "coach", kind: "new", new_start_at: "2026-11-19T15:00:00Z", created_at: "2026-11-18T19:00:03.000Z", profiles: { full_name: "Other Person" } },
        { coach_id: "coach", kind: "new", new_start_at: "2026-11-19T14:00:00Z", created_at: at, profiles: { full_name: "Hewan Belete" } },
      ],
    });
    expect(await requestPushLine(two, { profile_id: "coach", group_id: null, type: "booking_request", body: "", created_at: at }, TZ)).toMatch(/^Hewan B. asked for Thu, Nov 19, 9:00 AM. Answer by /);
  });
});

describe("the Requests page", () => {
  const page = read("app/(coach)/requests/page.tsx");
  const center = read("components/coach/requests-center.tsx");
  const server = read("lib/requests-center-server.ts");
  it("the open organization's sessions, late changes and schedule changes; every organization's requests to train", () => {
    expect(page).toContain("const orgGroupIds = active.groups.filter((g) => g.orgId === active.orgId).map((g) => g.id);");
    expect(center).toContain("<LateChangesPanel groupIds={groupIds} />");
    expect(center).toContain("<ScheduleRequestsPanel groupIds={groupIds} />");
    expect(server).toContain('supabase.rpc("coach_client_requests", { p_status: status, p_org: o.id })');
    expect(server).toContain(".filter((r) => inOrg.has(r.group_id))");
  });
  it("opens at the notice's request; one answered long ago is still shown, and one that cannot be found says so", () => {
    expect(server).toContain("if (!focus && opts.noticeId) focus = await requestForNotice(supabase, opts.userId, opts.noticeId);");
    expect(server).toContain("const one = await readOneAnswered(supabase, opts.userId, focus, tz, nowIso);");
    expect(center).toContain('el.setAttribute("data-focused", "true");');
    expect(center).toContain("That request isn&apos;t waiting any more.");
  });
  it("reads the people on the right foreign key (bookings and requests point at profiles more than once)", () => {
    expect(server).toContain("profiles!booking_requests_athlete_id_fkey ( full_name )");
    expect(server).toContain("profiles!bookings_athlete_id_fkey ( full_name )");
    expect(server).toContain("profiles!schedule_requests_athlete_id_fkey ( full_name )");
  });
  it("is in the phone shell and the computer shell, and keeps a choice of organization's place", () => {
    expect(page).toContain("<CoachMobileShell groupId={anchor.id} groupName={anchor.name}>");
    expect(page).toContain('<CoachDesktopShell groupId={anchor.id} groupName={anchor.name} active="clients" coachLevel>');
    expect(page).toContain("redirect(`${CHOOSE_ORGANIZATION_PATH}?next=${encodeURIComponent(next)}`);");
  });
  it("Home's Needs-you items open the Requests page at the request", () => {
    const needs = read("lib/needs-you-data.ts");
    expect(needs).toContain('href: requestHref("schedule", r.id)');
    expect(needs).toContain('href: requestHref("booking", r.id)');
    expect(needs).toContain('href: requestHref("late", l.id)');
  });
});

describe("a request's push says who and when", () => {
  it("short names, the session's time on the coach's clock, a schedule change's day", () => {
    expect(shortName("Hewan Belete")).toBe("Hewan B.");
    expect(shortName("Cher")).toBe("Cher");
    expect(shortName("  ")).toBe("Someone");
    // with when to answer by (wave 3 C1): a new session lapses at its time, a move at the ORIGINAL time
    const evening = new Date("2026-11-18T23:00:00Z");
    expect(bookingRequestLine({ kind: "new", new_start_at: "2026-11-19T14:00:00Z" }, "Hewan B.", TZ, evening)).toBe("Hewan B. asked for Thu, Nov 19, 9:00 AM. Answer by tomorrow 9:00 AM");
    expect(bookingRequestLine({ kind: "move", from_start_at: "2026-11-19T14:00:00Z", new_start_at: "2026-11-20T15:00:00Z" }, "Hewan B.", TZ, evening)).toBe("Hewan B. asked to move Thu, Nov 19, 9:00 AM to Fri, Nov 20, 10:00 AM. Answer by tomorrow 9:00 AM");
    expect(scheduleRequestLine({ kind: "pause", effective_on: "2026-11-24", recurring_booking_series: { weekday: 2, start_time: "06:00:00" } }, "Hewan B.")).toBe("Hewan B. asked to pause Tuesdays at 6:00 AM after Nov 24");
    expect(scheduleRequestLine({ kind: "freeze", effective_on: "2026-11-24", resume_on: "2026-12-15", recurring_booking_series: null }, "Hewan B.")).toBe("Hewan B. asked to freeze their weekly schedule after Nov 24 until Dec 15");
  });
  it("found from the request written with the notice; the notice's own line when there is none", async () => {
    const n = { profile_id: "coach", group_id: "g1", type: "booking_request", body: "Hewan Belete asked for a session on Thu Nov 19, 9:00 AM. Confirm or decline.", created_at: "2026-11-18T19:00:00.000Z" };
    const db = fakeDb({ booking_requests: [{ coach_id: "coach", group_id: "g1", kind: "new", new_start_at: "2026-11-19T14:00:00Z", created_at: "2026-11-18T19:00:00.000Z", profiles: { full_name: "Hewan Belete" } }] });
    expect(await requestPushLine(db, n, TZ)).toMatch(/^Hewan B. asked for Thu, Nov 19, 9:00 AM. Answer by /);
    expect(await requestPushLine(fakeDb({}), n, TZ)).toBe("Hewan Belete asked for a session on Thu Nov 19, 9:00 AM.");
    const c = { ...n, type: "client_request", body: "Hewan B. asked to train with you." };
    expect(await requestPushLine(fakeDb({ client_requests: [{ coach_id: "coach", created_at: n.created_at, profiles: { full_name: "Hewan Belete" } }] }), c, TZ)).toBe("Hewan B. asked to train with you");
  });
  it("the push job uses it for the three requests; the buttons stay on session requests only, and never on a private lock screen", () => {
    const job = read("app/api/cron/notification-push/route.ts");
    expect(job).toContain("const isRequest = (REQUEST_PUSH_TYPES as readonly string[]).includes(n.type);");
    expect(job).toContain('const requestId = n.type === "booking_request" ? await waitingRequestFor(db, n).catch(() => null) : null;');
    expect(read("lib/send-push.ts")).toContain("...(opts.answer && !prefs.generic ? { requestId: opts.answer.requestId } : {})");
    expect(read("lib/push-prefs.ts")).toContain("return prefs.generic ? { title: GENERIC_PUSH_TITLE, body: GENERIC_PUSH_BODY } : { title, body };");
  });
});

describe("the client hears the answer at once", () => {
  const now = read("lib/push-now.ts");
  const route = read("app/api/bookings/request-answer/route.ts");
  it("the answer route pushes the client's notice right after the database wrote it", () => {
    expect(route).toContain("const since = justBefore();");
    expect(route).toContain('if (athleteId) await pushNoticeNow(athleteId, "request_decision", since);');
    // the decision is still the coach's own sign-in
    expect(route).not.toContain("service-role");
  });
  it("claims the notice so the five-minute job never sends it again; quiet hours leave it for the job; a failed push gives it back", () => {
    expect(now).toContain('.update({ pushed_at: new Date().toISOString() })');
    expect(now).toContain('.is("pushed_at", null)');
    expect(now).toContain("if (isQuietNow(await readPushPrefs(db, profileId))) return 0;");
    expect(now).toContain('await db.from("notifications").update({ pushed_at: null }).eq("id", n.id);');
  });
  it("every Confirm and Decline in the app goes through that route", () => {
    expect(read("components/coach/late-changes-panel.tsx")).toContain('fetch("/api/bookings/request-answer"');
    expect(read("components/coach/late-changes-panel.tsx")).not.toContain('rpc("resolve_booking_request"');
    expect(read("components/notifications/notification-list.tsx")).toContain('fetch("/api/bookings/request-answer"');
  });
});

describe("the notifications page and the phone bell", () => {
  it("chips by kind, scrolling sideways on a phone; request rows answered on the row", () => {
    const list = read("components/notifications/notification-list.tsx");
    expect(list).toContain('className="flex gap-2 overflow-x-auto pb-1 mb-4 -mx-1 px-1" role="group" aria-label="Kind"');
    expect(list).toContain('{n.answer.kind === "booking" ? "Confirm" : "Approve"}');
    expect(read("app/notifications/page.tsx")).toContain("answer: answerable.get(n.id) ?? null,");
  });
  it("a bell with the unread count beside Spotlight on the phone, not where a bar already fills the top", () => {
    const hub = read("components/coach/mobile/coach-spot-hub.tsx");
    expect(hub).toContain("{bell && !compact && !embedded && profileId && (");
    expect(hub).toContain("<NotificationBell viewerId={profileId} scopeGroupId={null} />");
    expect(read("components/athlete/acting-as-banner.tsx")).toContain("<CoachSpotHub groupId={groupId} bell={self} />");
    expect(read("components/athlete/notification-bell.tsx")).toContain('{unreadCount > 9 ? "9+" : unreadCount}');
  });
});
