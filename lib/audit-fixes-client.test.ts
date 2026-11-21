import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/supabase/client", () => ({ createBrowserClient: () => ({}) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {} }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

import { checkinCardState } from "@/lib/client-home-asks";
import { buildMoreSections } from "@/lib/more-links";
import { joinView } from "@/lib/group-sessions";
import { justBookedHref } from "@/components/athlete/book-slot-button";
import { clampWeeks } from "@/components/athlete/recurring-booking-button";
import { DayCard, startHref, viewHref } from "@/components/athlete/day-card";
import { WeeklyCheckinCard } from "@/components/athlete/weekly-checkin-card";
import { ClassesList } from "@/components/athlete/classes-list";
import { PhotoCompare } from "@/components/athlete/progress/photo-compare";
import { OneRepMaxCalculator } from "@/components/tools/one-rep-max-calculator";
import { percentageTable } from "@/lib/one-rep-max";
import { cameFromThisApp } from "@/components/shared/back-or-home-link";
import { mySpaceTarget, placeParams } from "@/lib/my-space-target";
import { SELF_NO_CHECKIN_LINE } from "@/lib/nutrition-tracking";

// The audit of buttons that scroll, mislink or dead-end (Ron, Nov 21: "yes fix all of them, tiles first on spotlight"): the client app (C) and the Spotlight / phone coach shell (P).
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const HOME = "app/(coach)/groups/[groupId]/page.tsx";

const dayCardProps = {
  groupId: "g",
  athleteId: "a",
  dateKey: "2026-11-21",
  dateLabel: "Today",
  isToday: true,
  macros: null,
  habits: [],
  weightLogs: [],
};

describe("C1 Home rest day: Book a session follows the booking mode", () => {
  it("goes where the Calendar card goes, and is gone in I-schedule-everyone mode", () => {
    const html = renderToStaticMarkup(createElement(DayCard, { ...dayCardProps, workout: { status: "rest", workoutId: null, title: null }, canBook: true, bookHref: "/groups/g/calendar/2026-11-23#request-different-time" }));
    expect(html).toContain('href="/groups/g/calendar/2026-11-23#request-different-time"');
    const none = renderToStaticMarkup(createElement(DayCard, { ...dayCardProps, workout: { status: "rest", workoutId: null, title: null }, canBook: false, bookHref: null }));
    expect(none).not.toContain("Book a session with your coach");
    const home = read(HOME);
    expect(home).toContain('const bookingMode = sb.error ? "free" : ((sb.data?.booking_mode as string | null) ?? "coach_schedules");');
    expect(home).toContain("const bookHref = await loadScheduleCardHref(supabase, { coachId, timezone, bookingMode, dayBase: `/groups/${params.groupId}/calendar`, messagesHref: `/groups/${params.groupId}/messages` }).catch(() => null);");
    expect(home).toContain("const canBook = !!bookHref;");
  });
});

describe("C2 the weekly check-in can be opened again", () => {
  it("the Home card stays as Sent, change it until the coach reviews it", () => {
    expect(checkinCardState({ available: true, row: null })).toBe("due");
    expect(checkinCardState({ available: true, row: { reviewed_at: null } })).toBe("sent");
    expect(checkinCardState({ available: true, row: { reviewed_at: "2026-11-21T10:00:00Z" } })).toBe(false);
    expect(checkinCardState({ available: false, row: null })).toBe(false);
    const html = renderToStaticMarkup(createElement(WeeklyCheckinCard, { groupId: "g", coachName: "Ron Arnold", sent: true }));
    expect(html).toContain("Check-in sent, change it");
    expect(html).toContain('href="/groups/g/check-in"');
    expect(read(HOME)).toContain('sent={checkinCard === "sent"} />}');
  });
  it("is under More for a client, and the sent screen has Change it", () => {
    const links = buildMoreSections({ groupId: "g", athleteId: "a", isCoach: false, historyImportEnabled: false }).flatMap((s) => s.links);
    expect(links.find((l) => l.label === "Weekly check-in")?.href).toBe("/groups/g/check-in");
    expect(buildMoreSections({ groupId: "g", athleteId: "a", isCoach: true, historyImportEnabled: false }).flatMap((s) => s.links).some((l) => l.label === "Weekly check-in")).toBe(false);
    expect(read("components/athlete/weekly-checkin-form.tsx")).toContain("onClick={() => setSent(false)}");
  });
});

describe("C3 a Join that needs a session says what to do", () => {
  it("offers Message your coach beside it", () => {
    expect(joinView({ capacity: 5, joined: 1, mine: null, balance: 0, started: false, cancelled: false }).needsSession).toBe(true);
    expect(joinView({ capacity: 5, joined: 1, mine: null, balance: 3, started: false, cancelled: false }).needsSession).toBeUndefined();
    const card = { id: "c1", title: "Saturday class", startIso: "2026-11-28T15:00:00Z", endIso: "2026-11-28T16:00:00Z", capacity: 5, joined: 1, waitlisted: 0, locationNote: null, mine: null, cancelled: false };
    const html = renderToStaticMarkup(createElement(ClassesList, { classes: [card], balance: 0, timezone: "UTC", nowIso: "2026-11-21T12:00:00Z", groupId: "g" }));
    expect(html).toContain('href="/groups/g/messages"');
    expect(html).toContain("Message your coach");
    expect(read("app/(coach)/groups/[groupId]/classes/page.tsx")).toContain("groupId={params.groupId} />");
  });
});

describe("C4 / C12 the goal sheet opens for writing", () => {
  it("Update my goal and the coach's notice open it with ?edit=1; it also opens that way while the coach's request waits", () => {
    expect(read("components/athlete/goal-review-card.tsx")).toContain("href={`/groups/${groupId}/goal?edit=1#goal-sheet`}");
    expect(read("app/api/goal-sheet/send/route.ts")).toContain("const path = `/groups/${groupId}/goal?edit=1#goal-sheet`;");
    expect(read("app/(coach)/groups/[groupId]/goal/page.tsx")).toContain('const startEditing = (await props.searchParams)?.edit === "1";');
    expect(read("components/shared/goal-sheet-section.tsx")).toContain('useState(viewer === "client" && (!hasAnswers || startEditing || waiting))');
  });
});

describe("C5 photo compare: Add a photo stays on the page", () => {
  it("opens the picker right there and adds the photo privately", () => {
    const html = renderToStaticMarkup(createElement(PhotoCompare, { photos: [], weighIns: [], waists: [], weightUnit: "lb", addHref: "/groups/g/progress-photos", owner: { athleteId: "a", groupId: "g" } }));
    expect(html).toContain("data-compare-add");
    expect(html).not.toContain('href="/groups/g/progress-photos"');
    expect(read("components/athlete/progress/photo-compare.tsx")).toContain("sharedWithCoach: false");
  });
});

describe("C6 / C21 the food Photo tile", () => {
  const p = read("components/athlete/photo-log-food-button.tsx");
  it("offers Take a photo (the camera) or Choose from photos", () => {
    expect(p).toContain('accept="image/*" capture="environment"');
    expect(p).toContain('<input ref={galleryRef} type="file" accept="image/*" className="hidden"');
    expect(p).toContain(">\n            Take a photo\n");
    expect(p).toContain(">\n            Choose from photos\n");
  });
  it("Try again opens the same picker again, at 44px", () => {
    expect(p).toContain("openPicker(lastPicker.current);");
    expect(p).toContain('className="min-h-11 px-3 font-body text-xs text-steel disabled:opacity-40"\n            data-photo-try-again');
  });
});

describe("C7 booked feedback", () => {
  it("the day page comes back saying You're booked on the row", () => {
    expect(justBookedHref("/groups/g/calendar/2026-11-23", "?client=x", "2026-11-23T21:00:00.000Z")).toBe("/groups/g/calendar/2026-11-23?client=x&booked=2026-11-23T21%3A00%3A00.000Z");
    expect(read("components/athlete/book-slot-button.tsx")).toContain("router.replace(justBookedHref(window.location.pathname, window.location.search, startAt), { scroll: false });");
    for (const f of ["app/(coach)/groups/[groupId]/calendar/[date]/page.tsx", "app/(coach)/groups/[groupId]/programs/[programId]/calendar/[date]/page.tsx"]) {
      expect(read(f), f).toContain("{searchParams.booked === iso && <JustBookedLine time={formatSlotTime(start, timezone)} />}");
    }
    expect(read("components/athlete/just-booked-line.tsx")).toContain('role="status"');
  });
});

describe("C8 / C13 Home's Start and View", () => {
  it("Start workout starts it in one tap; another day's link opens the preview", () => {
    expect(startHref("g", "w1", true)).toBe("/groups/g/workouts/w1?start=1");
    expect(startHref("g", "w1", false)).toBe("/groups/g/workouts/w1");
    const html = renderToStaticMarkup(createElement(DayCard, { ...dayCardProps, workout: { status: "planned", workoutId: "w1", title: "Day 1" }, canBook: false }));
    expect(html).toContain('href="/groups/g/workouts/w1?start=1"');
    const page = read("app/(coach)/groups/[groupId]/workouts/[workoutId]/page.tsx");
    expect(page).toContain("const autoStart = wantsStart && !effective.isActingAsOther;");
    expect(page).toContain("if (autoStart && data.existingSession) {");
    expect(read("components/logging/workout-overview-view.tsx")).toContain("autoStart={autoStart && !loggedByCoach}");
    const btn = read("components/logging/start-workout-button.tsx");
    expect(btn).toContain("if (!autoStart || autoStarted.current) return;");
  });
  it("View on a finished workout opens its session", () => {
    expect(viewHref("g", "w1", { w1: "s9" })).toBe("/sessions/s9");
    expect(viewHref("g", "w2", { w1: "s9" })).toBe("/groups/g/workouts/w2");
    const html = renderToStaticMarkup(createElement(DayCard, { ...dayCardProps, workout: { status: "done", workoutId: "w1", title: "Day 1" }, canBook: false, doneSessionByWorkout: { w1: "s9" } }));
    expect(html).toContain('href="/sessions/s9"');
    expect(read(HOME)).toContain('.select("workout_id, session_id")');
  });
});

describe("C9 Repeat for __ weeks", () => {
  it("keeps what is typed and reads it as 1 to 12 when the box is left or Confirm is pressed", () => {
    expect(clampWeeks("")).toBe(1);
    expect(clampWeeks("8")).toBe(8);
    expect(clampWeeks("40")).toBe(12);
    expect(clampWeeks("0")).toBe(1);
    const r = read("components/athlete/recurring-booking-button.tsx");
    expect(r).toContain('inputMode="numeric"');
    expect(r).toContain("onBlur={() => setWeeksText(String(clampWeeks(weeksText)))}");
    expect(r).toContain("const occurrences = clampWeeks(weeksText);");
  });
});

describe("C10 / C11 Nutrition", () => {
  it("Set my targets opens the targets in a pop-up with the first box focused", () => {
    const s = read("components/athlete/set-my-targets-sheet.tsx");
    expect(s).toContain('<HomeSheet open={open} title="Set my targets" onClose={() => setOpen(false)} returnFocusTo="[data-set-targets]" focusFirstField>');
    expect(s).toContain("<SetMyTargetsCard {...card} />");
    expect(read("app/(coach)/groups/[groupId]/nutrition/page.tsx")).toContain("{setMyTargets && <SetMyTargetsSheet {...setMyTargets} />}");
    expect(read("components/athlete/home-sheet.tsx")).toContain("if (!open || !focusFirstField) return;");
  });
  it("the reasoning card is named for what it is", () => {
    const page = read("app/(coach)/groups/[groupId]/nutrition/page.tsx");
    expect(page).toContain("Why your target is what it is");
    expect(page).not.toContain("hasn&apos;t run a weekly check-in");
    expect(SELF_NO_CHECKIN_LINE).toBe("No change to your target yet.");
  });
});

describe("C14 / C15 / C16 the way back", () => {
  it("a client's message thread goes back where they came from, or Home", () => {
    expect(cameFromThisApp("https://app.test/groups/g", "https://app.test", 3)).toBe(true);
    expect(cameFromThisApp("https://elsewhere.test/", "https://app.test", 3)).toBe(false);
    expect(cameFromThisApp("", "https://app.test", 3)).toBe(false);
    expect(cameFromThisApp("https://app.test/groups/g", "https://app.test", 1)).toBe(false);
    expect(read("app/(coach)/groups/[groupId]/messages/[otherId]/page.tsx")).toContain("<BackOrHomeLink fallbackHref={`/groups/${params.groupId}`}");
  });
  it("the More pages say ← More and go there", () => {
    for (const f of ["goal", "progress-photos", "quick-tips", "resources", "my-history", "tools/macro-calculator", "tools/one-rep-max"]) {
      const s = read(`app/(coach)/groups/[groupId]/${f}/page.tsx`);
      expect(s, f).not.toMatch(/Back to settings/i);
      expect(s, f).toContain("`/groups/${params.groupId}/more`");
    }
  });
  it("Settings' text links are 44px", () => {
    const s = read("app/(coach)/groups/[groupId]/settings/page.tsx");
    expect(s).toContain('<Link href="/help" className="min-h-11 inline-flex items-center font-body text-sm text-chalk">');
    expect(s).toContain('<Link href={`/groups/${params.groupId}/more`} className="min-h-11 inline-flex items-center font-body text-sm text-chalk">');
  });
});

describe("C17 calculators", () => {
  it("the 1RM calculator is in the person's unit with number keyboards", () => {
    const kg = renderToStaticMarkup(createElement(OneRepMaxCalculator, { unit: "kg" }));
    expect(kg).toMatch(/Weight \((<!-- -->)?kg(<!-- -->)?\)/);
    expect(kg).not.toContain("lbs");
    expect(kg).toContain('inputMode="decimal"');
    expect(kg).toContain('inputMode="numeric"');
    expect(kg).toContain('value="100"');
    expect(percentageTable(100, 2.5)[0]).toEqual({ pct: 95, weight: 95 });
    expect(percentageTable(101, 2.5)[2]).toEqual({ pct: 85, weight: 85 });
    expect(percentageTable(225)[0]).toEqual({ pct: 95, weight: 215 });
    expect(read("app/(coach)/groups/[groupId]/tools/one-rep-max/page.tsx")).toContain("<OneRepMaxCalculator unit={await loadLiftUnit(supabase, effective.athleteId)} />");
    expect(read("components/tools/macro-calculator.tsx").match(/inputMode="decimal"/g)?.length).toBe(2);
  });
});

describe("C18 / C19 / C20 small things", () => {
  it("the first box is focused when these open", () => {
    expect(read("components/athlete/meal-checkoff-list.tsx")).toContain("<textarea aria-label={placeholder}\n            autoFocus");
    expect(read("components/athlete/progress/measurements-view.tsx")).toContain("autoFocus={i === 0}");
  });
  it("the photo journal's Share and Delete are 44px", () => {
    const j = read("components/athlete/progress-photo-journal.tsx");
    expect(j).toContain('<label className="flex items-center gap-2 min-h-11 font-body text-xs text-chalk cursor-pointer">');
    expect(j).toContain('className="min-h-11 inline-flex items-center font-body text-xs text-steel active:text-rust-ink transition-colors"');
  });
  it("an empty My progress offers today's workout", () => {
    expect(read("components/athlete/progress/my-progress-view.tsx")).toContain("Go to today&apos;s workout");
  });
});

describe("Spotlight and the phone coach shell", () => {
  const hub = read("components/coach/mobile/coach-spot-hub.tsx");
  it("P30: the tiles come first; what is waiting is under them, folded (a notice naming a panel opens it)", () => {
    const tiles = hub.indexOf("{TILES.filter((tile) => !(teamSport && TEAM_SPORT_HIDDEN_HUB_TILES.includes(tile.key))).map((tile) => {");
    const fold = hub.indexOf("data-spot-needs-fold");
    expect(tiles).toBeGreaterThan(-1);
    expect(fold).toBeGreaterThan(tiles);
    expect(hub.indexOf("<SpotNeedsTop")).toBeGreaterThan(fold);
    expect(hub).toContain("{needsOpen && (\n                        <SpotNeedsTop");
    expect(hub).toContain("if (anchor) {\n        setNeedsOpen(true);");
  });
  it("P10: a tap inside a sheet opened from Spotlight does not close Spotlight", () => {
    expect(hub).toContain(`if (target instanceof Element && target.closest('[role="dialog"], [role="alertdialog"], [aria-modal="true"], [data-spot-keep-open]')) return;`);
    expect(read("components/coach/desktop/use-template-panel.tsx")).toContain("onClick={onClose} data-spot-keep-open>");
  });
  it("P11: Start {Name}'s workout opens their log page (today's workout or Wing it)", () => {
    expect(read("components/coach/mobile/spot-needs-top.tsx")).toContain("const nextHref = needs.next ? `/groups/${needs.next.groupId}/athletes/${needs.next.athleteId}/log` : null;");
  });
  it("P19: Start your own workout starts it (through the own space's Today)", () => {
    expect(read("components/coach/mobile/spot-clients-groups-panel.tsx")).toContain('router.push("/my-space/home?start=1");');
    expect(placeParams("home", new URLSearchParams("start=1")).get("start")).toBe("1");
    expect(mySpaceTarget("space1", placeParams("home", new URLSearchParams("start=1")))).toBe("/groups/space1/today?start=1");
    expect(mySpaceTarget("space1", placeParams("home", new URLSearchParams()))).toBe("/groups/space1");
    expect(read("app/(coach)/groups/[groupId]/today/page.tsx")).toContain('redirect(`/groups/${params.groupId}/workouts/${result.workoutId}${start ? "?start=1" : ""}`);');
  });
  it("P20: a new group opens on its clients", () => {
    expect(read("components/coach/mobile/spot-clients-groups-panel.tsx")).toContain("router.push(`/groups/${made.id}/clients`);");
  });
  it("P26-P29: 44px to tap", () => {
    expect(hub.match(/w-11 h-11 -my-1\.5/g)?.length).toBe(2);
    expect(hub).toContain('className="h-11 -my-1.5 max-w-[9rem]');
    const panel = read("components/coach/mobile/spot-clients-groups-panel.tsx");
    expect(panel).not.toMatch(/\bh-(6|8|9|10)\b(?! rounded-full)/);
    expect(read("components/coach/mobile/quick-view-bubble.tsx")).toContain('className="w-11 h-11 -mr-2 flex items-center justify-center text-steel"');
    const roster = read("components/coach/mobile/coach-roster-mobile.tsx");
    expect(roster).toContain("w-11 h-[min(1.5rem,calc(70vh/26))]");
    expect(roster).toContain("onPointerMove={scrubTo}");
    const bell = read("components/athlete/notification-bell.tsx");
    expect(bell).toContain('className="min-h-11 px-2 -mr-2 inline-flex items-center font-body text-xs text-rust-ink"');
    expect(bell).toContain('className="min-h-11 flex items-center justify-center px-3 border-t border-steel/15 font-body text-xs text-steel"');
  });
  it("P31: an answer to Did this session happen? re-reads the count", () => {
    expect(read("components/coach/session-check-cards.tsx").match(/markGone\(s\.bookingId\);/g)?.length).toBe(3);
    expect(hub).toContain("onChanged={() => loadNeeds(true)}");
  });
  it("P32: one way to the full profile in the roster's quick view", () => {
    const roster = read("components/coach/mobile/coach-roster-mobile.tsx");
    expect(roster).not.toContain('deeperLabel="Open full profile"');
    expect(roster).toContain("Open profile");
  });
  it("P33: a link to a folded nutrition section opens it every time", () => {
    const f = read("components/coach/nutrition/fold-section.tsx");
    expect(f).toContain('document.addEventListener("click", onClick);');
    expect(f).toContain("if (!href.endsWith(`#${id}`) || !ref.current) return;");
  });
  it("P34: Build a program fills the screen (drawn on the page, not in the card)", () => {
    expect(read("components/coach/mobile/spot-builder-panel.tsx")).toContain('return typeof document === "undefined" ? box : createPortal(box, document.body);');
  });
});
