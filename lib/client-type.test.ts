import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }) }));
vi.mock("@/lib/supabase/client", () => ({ createBrowserClient: () => ({}) }));

import { CLIENT_TYPE_CHOICES, offeredForBooking, readShowOnline, SHOW_ONLINE_KEY, writeShowOnline } from "@/lib/client-type";
import { ScheduleClientPicker } from "@/components/coach/schedule-client-picker";
import { ClientRowMenu } from "@/components/coach/desktop/client-row-menu";
import type { ClientTierLite } from "@/lib/session-type-default";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

interface C {
  id: string;
  tier: ClientTierLite;
  aside?: boolean;
}
const clients: C[] = [
  { id: "in-person", tier: "one_on_one" },
  { id: "no-tier", tier: null },
  { id: "group", tier: "group" },
  { id: "online", tier: "online" },
  { id: "online-aside", tier: "online", aside: true },
  { id: "aside", tier: "one_on_one", aside: true },
];
const offer = (extra: Partial<Parameters<typeof offeredForBooking<C>>[1]> = {}) =>
  offeredForBooking(clients, { tierOf: (c) => c.tier, isSetAside: (c) => !!c.aside, showOnline: false, ...extra }).map((c) => c.id);

// Ron, Oct 19: the scheduler's client list shows only the clients he sees in person; Online ones behind a small "Show online clients" switch, remembered.
describe("who is offered for booking", () => {
  it("by default: in person, no tier set, and group clients; not Online, not set aside", () => {
    expect(offer()).toEqual(["in-person", "no-tier", "group"]);
  });
  it("'Show online clients' adds the online ones back, never the set-aside ones", () => {
    expect(offer({ showOnline: true })).toEqual(["in-person", "no-tier", "group", "online"]);
  });
  it("'Show set-aside' (the list's other switch) adds those", () => {
    expect(offer({ showSetAside: true })).toEqual(["in-person", "no-tier", "group", "aside"]);
    expect(offer({ showSetAside: true, showOnline: true })).toHaveLength(6);
  });
  it("the client already picked always stays in the list, even if online or set aside", () => {
    expect(offer({ keep: (c) => c.id === "online" })).toContain("online");
    expect(offer({ keep: (c) => c.id === "online-aside" })).toContain("online-aside");
  });
});

describe("the switch is remembered, and reading it never throws", () => {
  it("hidden unless the saved value is exactly on", () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    expect(readShowOnline(storage)).toBe(false);
    writeShowOnline(storage, true);
    expect(mem.get(SHOW_ONLINE_KEY)).toBe("1");
    expect(readShowOnline(storage)).toBe(true);
    writeShowOnline(storage, false);
    expect(readShowOnline(storage)).toBe(false);
  });
  it("private windows and blocked storage fall back to hidden", () => {
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readShowOnline(blocked)).toBe(false);
    expect(() => writeShowOnline(blocked, true)).not.toThrow();
    expect(readShowOnline(null)).toBe(false);
  });
});

describe("the phone's 'Calendar for' list", () => {
  const options = [
    { id: "a", fullName: "Amber In-person", balance: 4, tier: "one_on_one" as const },
    { id: "b", fullName: "Brendan Online", balance: 2, tier: "online" as const },
    { id: "c", fullName: "Cindie Aside", balance: 1, tier: "one_on_one" as const, setAside: true },
  ];
  it("leaves Online and set-aside clients out until asked, with one small toggle that says how many", () => {
    const html = renderToStaticMarkup(createElement(ScheduleClientPicker, { groupId: "g", clients: options }));
    expect(html).toContain("Amber In-person");
    expect(html).not.toContain("Brendan Online");
    expect(html).not.toContain("Cindie Aside");
    expect(html).toContain("Show online clients (1)");
  });
  it("keeps the client the calendar is showing even when online", () => {
    const html = renderToStaticMarkup(createElement(ScheduleClientPicker, { groupId: "g", clients: options, selectedId: "b" }));
    expect(html).toContain("Brendan Online");
  });
  it("no toggle when there is no online client", () => {
    const html = renderToStaticMarkup(createElement(ScheduleClientPicker, { groupId: "g", clients: options.filter((o) => o.id === "a") }));
    expect(html).not.toContain("Show online clients");
  });
});

describe("Client type in the three-dot menu", () => {
  it("the choices are In person, Online, Group", () => {
    expect(CLIENT_TYPE_CHOICES.map((c) => [c.value, c.label])).toEqual([["one_on_one", "In person"], ["online", "Online"], ["group", "Group"]]);
  });
  it("offers the three types with the current one checked (rendered once opened is client-side; the source holds the radio items)", () => {
    const html = renderToStaticMarkup(createElement(ClientRowMenu, { groupId: "g", athleteId: "a", athleteName: "Amber", clientType: "online" }));
    expect(html).toContain("Actions for Amber");
  });
  it("changes the type in one tap: no confirm dialog, the client's own tier, and a refused save is reported, never hidden", () => {
    const src = read("components/coach/desktop/client-row-menu.tsx");
    const fn = src.slice(src.indexOf("async function chooseType"), src.indexOf("async function removeClient"));
    expect(fn).toContain('.update({ client_tier: next })');
    expect(fn).toContain('.eq("group_id", groupId).eq("profile_id", athleteId).eq("role", "athlete")');
    expect(fn).not.toContain("confirmDialog");
    expect(fn).toContain("data.length === 0");
    expect(src).toContain('role="menuitemradio"');
    expect(src).toContain("aria-checked={clientType === choice.value}");
  });
  it("both rows of the Clients page pass the client's current type", () => {
    expect(read("components/coach/desktop/coach-clients-list.tsx").match(/clientType=\{clientKind\(c\)\}/g)?.length).toBe(2);
  });
});

describe("everywhere clients are offered for booking uses the same rule", () => {
  it("the desktop calendar list and the phone list both filter with offeredForBooking and share the remembered switch", () => {
    for (const f of ["components/coach/desktop/calendar-client-rail.tsx", "components/coach/schedule-client-picker.tsx"]) {
      const src = read(f);
      expect(src, f).toContain("offeredForBooking(");
      expect(src, f).toContain("useShowOnlineClients()");
    }
  });
  it("the calendar page hands both lists each client's tier and set-aside state", () => {
    const src = read("components/coach/calendar-page-body.tsx");
    expect(src).toContain("tier: tierByClientGroup.get(");
    expect(src).toContain("tier: phoneTierByKey.get(");
    expect(src).toContain("setAside: phoneAsideKeys.has(");
    expect(src).toContain("setAside: asideHere.has(");
  });
});
