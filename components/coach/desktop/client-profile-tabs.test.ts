import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => "/groups/g1/athletes/a1" }));

import { ClientProfileTabs } from "@/components/coach/desktop/client-profile-tabs";
import { CLIENT_PROFILE_TABS, LOADED_ON_OPEN, isClientProfileTab } from "@/lib/client-profile-tabs";
import { loadDirectThread } from "@/lib/direct-thread";

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = src("../../../app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx");
const calendarPage = src("../../../app/(coach)/groups/[groupId]/athletes/[athleteId]/calendar/page.tsx");
const messagesPage = src("../../../app/(coach)/groups/[groupId]/messages/[otherId]/page.tsx");
const calendarSection = src("./client-calendar-section.tsx");
const css = src("../../../app/globals.css");

describe("the tab strip", () => {
  it("has the eight tabs in the order the coach sees them", () => {
    expect(CLIENT_PROFILE_TABS.map((t) => t.label)).toEqual(["Overview", "Messages", "Programs", "Nutrition", "Calendar", "Progress", "Forms & notes", "Billing & settings"]);
    expect(isClientProfileTab("messages")).toBe(true);
    expect(isClientProfileTab("calendar")).toBe(true);
    expect(isClientProfileTab("nonsense")).toBe(false);
  });
  it("every tab is a button on this page (none leaves the profile), and the strip wraps instead of scrolling", () => {
    const html = renderToStaticMarkup(createElement(ClientProfileTabs, { groupId: "g1", athleteId: "a1", initial: "overview" }));
    expect((html.match(/<button/g) ?? []).length).toBe(8);
    expect(html).not.toContain("<a ");
    expect(html).toContain("flex-wrap");
    expect(html).not.toContain("overflow-x-auto");
    expect(html).toContain('aria-pressed="true"');
  });
  it("Messages and Calendar are loaded when opened; the others are already on the page", () => {
    expect(LOADED_ON_OPEN).toEqual(["messages", "calendar"]);
    for (const tab of ["messages", "calendar"]) expect(css).toContain(`#client-profile-body[data-active-tab="${tab}"] [data-tab]:not([data-tab~="${tab}"])`);
  });
});

describe("the profile page", () => {
  it("the action row on desktop keeps only Upload exercise history and Record check-in", () => {
    const header = page.slice(page.indexOf("{profileFlag && ("), page.indexOf('<div id="client-profile-body"'));
    expect(header).toContain("Upload exercise history");
    expect(header).toContain("<VideoCheckinRecorder");
    for (const gone of ["Log in-person session", "Programming", "This client&apos;s calendar", "Schedule session", "Message<", "Current program:"]) expect(header, gone).not.toContain(gone);
  });
  it("a quiet current-program line stays in the header", () => {
    expect(page).toContain("activeProgram.name");
    expect(page.slice(page.indexOf("Joined {new Date"), page.indexOf("{profileFlag && ("))).toContain("activeProgram");
  });
  it("Messages and Calendar show their content right below the tabs, and only load it when that tab is open", () => {
    expect(page).toContain('initialTab === "messages" && <ClientMessagesSection');
    expect(page).toContain('initialTab === "calendar" && (');
    expect(page).toContain("<ClientCalendarSection");
    expect(page).toContain("tab=calendar&month=");
  });
  it("no workflow is lost: assigning a program and logging an in-person session are in the Programs tab, scheduling a session and logging one are in the Calendar tab", () => {
    const programs = page.slice(page.indexOf('<div data-tab="program"'), page.indexOf('<div className="profile-grid'));
    expect(programs).toContain("<ClientProgramActions");
    expect(programs).toContain("Log an in-person session");
    expect(programs).toContain("/log`");
    expect(calendarSection).toContain("Schedule a session for");
    expect(calendarSection).toContain("scheduleFor=");
    expect(calendarSection).toContain("Log an in-person session");
  });
  it("the full pages stay (deep links, the phone) and use the very same pieces", () => {
    expect(calendarPage).toContain("<ClientCalendarSection");
    expect(messagesPage).toContain("loadDirectThread(");
    expect(src("./client-messages-section.tsx")).toContain("loadDirectThread(");
    expect(src("./client-messages-section.tsx")).not.toContain("Open on its own page"); // the coach on a computer has no separate message page any more
  });
});

// A stand-in for the calls loadDirectThread makes.
function fakeDb() {
  const updates: { table: string; values: Record<string, unknown>; filters: [string, unknown][] }[] = [];
  const db = {
    from(table: string) {
      return {
        select() {
          const chain: Record<string, unknown> = { eq: () => chain, or: () => chain, order: () => Promise.resolve({ data: [{ id: "m1", sender_id: "a1", body: "hi", created_at: "2026-10-08T10:00:00Z" }], error: null }) };
          return chain;
        },
        update(values: Record<string, unknown>) {
          const filters: [string, unknown][] = [];
          const chain: Record<string, unknown> = {
            eq: (c: string, v: unknown) => (filters.push([c, v]), chain),
            is: (c: string, v: unknown) => (filters.push([c + " is", v]), updates.push({ table, values, filters }), Promise.resolve({ error: null })),
          };
          return chain;
        },
      };
    },
  };
  return { db: db as unknown as SupabaseClient, updates };
}

describe("loadDirectThread", () => {
  it("returns the conversation and marks what the other person sent, and the bell line, as read", async () => {
    const { db, updates } = fakeDb();
    const messages = await loadDirectThread(db, { groupId: "g1", viewerId: "coach", otherId: "a1" });
    expect(messages).toHaveLength(1);
    const dm = updates.find((u) => u.table === "direct_messages")!;
    expect(dm.filters).toContainEqual(["recipient_id", "coach"]);
    expect(dm.filters).toContainEqual(["sender_id", "a1"]);
    const bell = updates.find((u) => u.table === "notifications")!;
    expect(bell.filters).toContainEqual(["link_path", "/groups/g1/messages/a1"]);
    expect(bell.filters).toContainEqual(["type", "direct_message"]);
  });
});

describe("leaving Messages", () => {
  const tabsSource = src("./client-profile-tabs.tsx");
  it("goes by address (the page stops rendering the thread) and never just hides it, so a message from the client is not marked read while the coach looks at another tab", () => {
    const choose = tabsSource.slice(tabsSource.indexOf("function choose"), tabsSource.indexOf("const base ="));
    // the navigation branch covers BOTH opening and leaving a load-on-open tab
    expect(choose).toContain("LOADED_ON_OPEN.includes(next) || LOADED_ON_OPEN.includes(tab)");
    expect(choose).toContain("router.push(");
    // the in-page switch (replaceState only) is reached only when neither tab is load-on-open
    expect(choose.indexOf("router.push(")).toBeLessThan(choose.indexOf("window.history.replaceState"));
  });
});

describe("workout logging style is the client's own choice", () => {
  it("the coach's client profile no longer shows or sets the swipe direction, and the coach-only route is gone", () => {
    expect(page).not.toContain("SwipeDirectionSetting");
    expect(page).not.toContain("Swipe direction");
    expect(page).not.toContain("exercise_swipe_direction");
    expect(existsSync(new URL("../../../app/api/coach/set-swipe-direction/route.ts", import.meta.url))).toBe(false);
    expect(src("../../athlete/swipe-direction-setting.tsx")).not.toContain("set-swipe-direction");
  });
  it("the client still has it in their own Settings", () => {
    expect(src("../../../app/(coach)/groups/[groupId]/settings/page.tsx")).toContain("<SwipeDirectionSetting");
  });
});
