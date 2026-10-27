import { describe, expect, it, vi } from "vitest";

// Oct 27: on a phone, "Back to calendar" (a soft link through /my-space?view=client&to=calendar) landed on Home as /groups/<space>?view=client&to=calendar. The browser's router remembers one
// answer per address WITHOUT what follows the "?", so it took the redirect it remembered for Home (/my-space?view=client -> /groups/<space>) for Calendar, keeping Calendar's query. Every place in
// the coach's own app now has its own path, /my-space/<place>.
const SPACE = "space-1";
vi.mock("@/lib/supabase/server", () => {
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "coach-1" } } }) },
    rpc: async () => ({ data: SPACE, error: null }),
    from: () => {
      const b: Record<string, unknown> = {};
      Object.assign(b, { select: () => b, eq: () => b, maybeSingle: async () => ({ data: { role: "coach" }, error: null }) });
      return b;
    },
  };
  return { createCrossOrgServerClient: async () => client, createServerClient: async () => client };
});

const { GET: place } = await import("@/app/my-space/[place]/route");
const { GET: mySpace } = await import("@/app/my-space/route");
const { mySpaceHref, MY_SPACE_PLACES, MY_SPACE_TABS } = await import("./my-space-target");
const { PHONE_CALENDAR, PHONE_OWN_APP, PHONE_SPOTLIGHT, phoneCalendarHref, phoneCoachRedirect } = await import("./phone-coach-routes");
const { COACH_PHONE_ENTRY, COACH_PHONE_ENTRY_KEEP_ORG, COACH_PHONE_LANDING } = await import("./start-group");
const { PHONE_ENTRY } = await import("./phone-coach-routes");

const ORIGIN = "https://spotlightcoaching.app";
// A soft link's request: the router's headers and its cache-busting _rsc parameter.
const soft = (path: string) => new Request(`${ORIGIN}${path}${path.includes("?") ? "&" : "?"}_rsc=1a2b3`, { headers: { RSC: "1", "Next-Router-State-Tree": "%5B%22%22%5D", "Next-Url": "/groups/g/calendar/2026-10-28" } });
const full = (path: string) => new Request(`${ORIGIN}${path}`, { headers: { accept: "text/html" } });
const where = (r: Response) => {
  const u = new URL(r.headers.get("location") ?? "", ORIGIN);
  return u.pathname + u.search;
};
const openPlace = async (req: Request) => where(await place(req, { params: Promise.resolve({ place: new URL(req.url).pathname.split("/")[2] }) }));

describe("each place in the coach's own app", () => {
  it("has its own path: no two places share one, and no phone link says where to go after the ?", () => {
    const links = [mySpaceHref(null), mySpaceHref(null, { spot: true }), ...MY_SPACE_TABS.map((t) => mySpaceHref(t)), PHONE_CALENDAR, PHONE_OWN_APP, PHONE_SPOTLIGHT, COACH_PHONE_LANDING];
    for (const l of links) expect(l, l).not.toMatch(/[?&](to|view)=/);
    const byPath = new Map<string, string>();
    for (const p of MY_SPACE_PLACES) byPath.set(`/my-space/${p}`, p);
    expect(byPath.size).toBe(6);
    expect(new Set([mySpaceHref(null), mySpaceHref(null, { spot: true }), ...MY_SPACE_TABS.map((t) => mySpaceHref(t))]).size).toBe(6);
  });

  it("no two phone entries share a path with a different meaning (the landing that keeps the organization is /coach-landing/keep-org, not ?keep=org)", () => {
    const entries: [string, string][] = [
      [COACH_PHONE_ENTRY, "fresh open: start in the home organization"],
      [COACH_PHONE_ENTRY_KEEP_ORG, "Home while working: keep the organization chosen"],
      [PHONE_ENTRY, "Home while working: keep the organization chosen"],
      [mySpaceHref(null), "own app: Home"],
      [COACH_PHONE_LANDING, "own app: Home"],
      [PHONE_OWN_APP, "own app: Home"],
      [mySpaceHref(null, { spot: true }), "own app: Spotlight"],
      [PHONE_SPOTLIGHT, "own app: Spotlight"],
      [PHONE_CALENDAR, "own app: calendar"],
      ...MY_SPACE_TABS.map((t): [string, string] => [mySpaceHref(t), `own app: ${t}`]),
    ];
    const meaningByPath = new Map<string, string>();
    for (const [href, meaning] of entries) {
      const path = new URL(href, ORIGIN).pathname;
      expect(meaningByPath.get(path) ?? meaning, `${href} shares ${path} with "${meaningByPath.get(path)}"`).toBe(meaning);
      meaningByPath.set(path, meaning);
      expect(href, href).not.toMatch(/[?&](to|view|keep|spot)=/);
    }
    expect(COACH_PHONE_ENTRY_KEEP_ORG).toBe("/coach-landing/keep-org");
    expect(PHONE_ENTRY).toBe(COACH_PHONE_ENTRY_KEEP_ORG);
  });

  for (const tab of MY_SPACE_TABS) {
    it(`${tab}: a soft link and a full load land on the same page, with the month kept`, async () => {
      const path = `/my-space/${tab}?month=2026-11`;
      const expected = `/groups/${SPACE}/${tab}?month=2026-11`;
      expect(await openPlace(full(path))).toBe(expected);
      expect(await openPlace(soft(path))).toBe(expected);
      // and the old address still goes to the same place
      expect(where(await mySpace(full(`/my-space?view=client&to=${tab}&month=2026-11`)))).toBe(expected);
    });
  }

  it("Home and Spotlight: the space's Home (Spotlight open for spotlight), soft or full", async () => {
    for (const req of [full, soft]) {
      expect(await openPlace(req("/my-space/home"))).toBe(`/groups/${SPACE}`);
      expect(await openPlace(req("/my-space/spotlight"))).toBe(`/groups/${SPACE}?spot=1`);
    }
    expect(where(await mySpace(full("/my-space?view=client&spot=1")))).toBe(`/groups/${SPACE}?spot=1`);
  });

  it("an unknown place opens Home; nothing but the month and Spotlight is passed on", async () => {
    expect(where(await place(full("/my-space/evil"), { params: Promise.resolve({ place: "evil" }) }))).toBe("/my-space/home");
    expect(await openPlace(full("/my-space/calendar?month=x&next=/evil"))).toBe(`/groups/${SPACE}/calendar`);
  });

  it("the phone's redirects use the paths: the computer's calendar pages go to the phone Calendar on their month", () => {
    expect(phoneCalendarHref("2026-11")).toBe("/my-space/calendar?month=2026-11");
    expect(phoneCalendarHref("nope")).toBe("/my-space/calendar");
    expect(phoneCoachRedirect("/calendar", "?month=2026-11")?.to).toBe("/my-space/calendar?month=2026-11");
    expect(phoneCoachRedirect("/groups/11111111-1111-4111-8111-111111111111/business")?.to).toBe("/my-space/spotlight");
  });
});
