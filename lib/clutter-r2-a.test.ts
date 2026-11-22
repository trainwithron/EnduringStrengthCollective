import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/supabase/client", () => ({ createBrowserClient: () => ({}) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {} }) }));

import { TodayTiles } from "@/components/athlete/today-tiles";
import { FoodSearchLog } from "@/components/athlete/food-search-log";
import { coachTodayLine, COACH_TODAY_HREF } from "@/lib/coach-today-line";
import { PHONE_CALENDAR } from "@/lib/phone-coach-routes";
import { channelsRead, feedTabs, feedTitle, openedChannel } from "@/lib/feed-channels";
import type { FeedChannel } from "@/lib/types";

// Clutter round 2, part A (Ron's calls, Nov 21): CL9, CL10, CL17 and PH25.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const HOME = "app/(coach)/groups/[groupId]/page.tsx";
const FEED = "app/(coach)/groups/[groupId]/feed/page.tsx";

describe("CL9: the daily check tile is How I Feel", () => {
  it("says How I Feel, never Check in; the weekly check-in keeps its own name", () => {
    const html = renderToStaticMarkup(createElement(TodayTiles));
    expect(html).toContain("How I Feel");
    expect(html).not.toContain("Check in");
    expect(read("components/athlete/weekly-checkin-card.tsx")).toContain("check-in");
  });
});

describe("CL10: the third tile is Log food", () => {
  it("shows only when Home says so, and opens the food search in a pop-up", () => {
    expect(renderToStaticMarkup(createElement(TodayTiles))).not.toContain('data-tile="food"');
    const html = renderToStaticMarkup(createElement(TodayTiles, { showFood: true }));
    expect(html).toContain('data-tile="food"');
    expect(html).toContain("Log food");
    expect(html).not.toContain("InBody");
  });
  it("Home shows it to anyone who can log food on Nutrition (tracking on, any tier, group included); InBody is off Home", () => {
    const home = read(HOME);
    expect(home).toContain("foodTile={isToday && foodTrackingOn}");
    // the tracking switch is read for every tier, before the macros-only eaten totals
    expect(home).toContain("      if (isToday) {\n        try {\n          const { data: trackingRow }");
    expect(home.indexOf('.select("food_tracking_enabled")')).toBeLessThan(home.indexOf("if (isToday && macrosEnabled) {\n        try {\n          const { data: loggedMeals"));
    const card = read("components/athlete/day-card.tsx");
    expect(card).toContain("{isToday && <TodayTiles showFood={foodTile} />}");
    expect(card).toContain("{foodTile && <LogFoodSheet athleteId={athleteId} groupId={groupId} logDate={dateKey} />}");
    expect(card).not.toContain("<InbodyEntry");
  });
  it("the pop-up opens with the keyboard up (flushSync, the search box first) and Home refreshes after a log", () => {
    const sheet = read("components/athlete/log-food-sheet.tsx");
    expect(sheet).toContain("flushSync(() => {");
    expect(sheet).toContain("focusFirstField");
    expect(sheet).toContain(`returnFocusTo='[data-tile="food"]'`);
    expect(sheet).toContain("onLogged={() => router.refresh()}");
    // inside the pop-up the search is open at once, with no second title or Close
    const html = renderToStaticMarkup(createElement(FoodSearchLog, { athleteId: "a", groupId: "g", logDate: "2026-11-21", onLogged: () => {}, inSheet: true }));
    expect(html).toContain('aria-label="Search foods"');
    expect(html).not.toContain(">Close<");
    // on Nutrition it still starts as the one big bar
    expect(renderToStaticMarkup(createElement(FoodSearchLog, { athleteId: "a", groupId: "g", logDate: "2026-11-21", onLogged: () => {} }))).toContain("Search foods");
  });
});

describe("CL17: the feed", () => {
  const none = new Set<FeedChannel>();
  it("a group that is not a team-sport one has one place to talk: General shows Team Chat's posts, and there is no Team Chat tab", () => {
    expect(openedChannel("team_chat", false)).toBe("general");
    expect(openedChannel("team_chat", true)).toBe("team_chat");
    expect(openedChannel("nonsense", false)).toBe("general");
    expect(channelsRead("general", false)).toEqual(["general", "team_chat"]);
    expect(channelsRead("general", true)).toEqual(["general"]);
    const tabs = feedTabs({ withPosts: new Set<FeedChannel>(["team_chat"]), active: "general", teamSport: false, isCoach: false });
    expect([...tabs.shown, ...tabs.more]).not.toContain("team_chat");
  });
  it("only channels with posts are tabs (plus the open one and General; Announcements for a coach); the rest are behind More", () => {
    expect(feedTabs({ withPosts: none, active: "general", teamSport: false, isCoach: false })).toEqual({ shown: ["general"], more: ["announcements", "form_checks", "pr_board"] });
    expect(feedTabs({ withPosts: none, active: "general", teamSport: false, isCoach: true }).shown).toEqual(["announcements", "general"]);
    expect(feedTabs({ withPosts: new Set<FeedChannel>(["pr_board"]), active: "form_checks", teamSport: false, isCoach: false }).shown).toEqual(["form_checks", "pr_board", "general"]);
    expect(feedTabs({ withPosts: none, active: "general", teamSport: true, isCoach: false }).more).toContain("team_chat");
    expect(read("components/feed/channel-tabs.tsx")).toContain("data-more-channels");
  });
  it("the merged General gets Team Chat's new posts live too", () => {
    const list = read("components/feed/feed-list.tsx");
    expect(list).toContain("const listenKey = (listensTo ?? [channel]).join(\",\");");
    expect(list).toContain("if (!listenKey.split(\",\").includes(payload.new.channel)) return;");
    expect(list).toContain("}, [groupId, viewerId, listenKey]);");
    expect(read(FEED).split("listensTo={channelsRead(channel, teamSport)}").length - 1).toBe(2);
  });
  it("clearing the merged General clears Team Chat's posts too (every other channel on its own)", () => {
    const btn = read("components/feed/clear-channel-button.tsx");
    expect(btn).toContain('.in("channel", channels ?? [channel]);');
    expect(btn).not.toContain('.eq("channel", channel)');
    expect(read(FEED).split("<ClearChannelButton groupId={params.groupId} channel={channel} channels={channelsRead(channel, teamSport)} />").length - 1).toBe(2);
  });
  it("the page's own group gives team_mode in its first read; only another group's feed reads it again", () => {
    const page = read(FEED);
    expect(page).toContain('.select("name, group_kind, organization_id, team_mode").eq("id", params.groupId)');
    expect(page).toContain("feedGroupId === params.groupId\n      ? { data: group as { team_mode: boolean | null } | null }");
  });
  it("step 222's index is only for speed: the feed's reads never name it, and the paste and undo hold the migration", () => {
    const sql = read("supabase/migrations/0466_posts_group_channel_index.sql");
    expect(sql).toContain("create index if not exists posts_group_channel_created on public.posts (group_id, channel, created_at desc);");
    expect(read("supabase/apply/apply-step222-0466.sql")).toContain(sql.trimEnd());
    expect(read("supabase/apply/undo-step222-0466.sql")).toContain("drop index if exists public.posts_group_channel_created;");
    for (const f of [FEED, "lib/feed-channels.ts", "components/feed/feed-list.tsx"]) expect(read(f), f).not.toContain("posts_group_channel_created");
  });
  it("is titled Feed, and Team feed only for a team-sport group", () => {
    expect(feedTitle(false)).toBe("Feed");
    expect(feedTitle(true)).toBe("Team feed");
    const page = read(FEED);
    expect(page).not.toMatch(/>\s*Team [Ff]eed\s*</);
    expect(page.match(/\{feedTitle\(teamSport\)\}/g)?.length).toBe(2);
  });
  it("pins the newest announcement above the list until it is read, and reads the posts of the channels the tab lists", () => {
    const page = read(FEED);
    expect(page).toContain('.in("channel", channelsRead(channel, teamSport))');
    expect(page).toContain('.eq("channel", "announcements")');
    expect(page).toContain('{pinned && channel !== "announcements" && (');
    expect(page).toContain("<MarkAnnouncementSeen groupId={feedGroupId} postId={pinned.id} />");
    const pin = read("components/feed/pinned-announcement.tsx");
    expect(pin).toContain("const [show, setShow] = useState(false);");
    expect(pin).toContain("data-announcement-got-it");
  });
});

describe("PH25: one line about today's coaching on the coach's phone Home", () => {
  const at = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 21, h, m)).toISOString();
  const now = new Date(Date.UTC(2026, 10, 21, 17, 0));
  it("says how many sessions and who is next; nothing with no session", () => {
    expect(coachTodayLine([], now, "UTC")).toBeNull();
    const line = coachTodayLine([{ startAt: at(20), name: "Jane Doe" }, { startAt: at(15), name: "Sam Lee" }, { startAt: at(18, 30), name: "Ana Ruiz" }, { startAt: at(21), name: "Bo Kim" }], now, "UTC");
    expect(line).toMatch(/^Today: 4 sessions · next Ana 6:30/);
    expect(coachTodayLine([{ startAt: at(15), name: "Sam Lee" }], now, "UTC")).toBe("Today: 1 session");
  });
  it("opens the phone Calendar (its Today list) and shows only on the coach's own phone Home", () => {
    expect(COACH_TODAY_HREF).toBe(PHONE_CALENDAR);
    const home = read(HOME);
    expect(home).toContain('prefersPhoneView && isActingAsOther && !!user && athleteId === user.id && view === "day" && isToday ? loadCoachTodayLine(supabase, user.id)');
    expect(home).toContain("{coachToday && (");
    expect(home).toContain("data-coach-today-line");
    // the same sessions as that list: the organization being worked in, confirmed, today
    const lib = read("lib/coach-today-line.ts");
    expect(lib).toContain("getActiveAnchor(supabase, coachId)");
    expect(lib).toContain('.eq("status", "confirmed")');
  });
});
