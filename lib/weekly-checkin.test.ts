import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/supabase/client", () => ({ createBrowserClient: () => ({}) }));
vi.mock("@/lib/push-notify", () => ({ notifyPush: () => {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }), usePathname: () => "/" }));

import {
  averageWeight,
  checkinPath,
  checkinSubline,
  checkinWeekStart,
  cleanCheckin,
  coachLabel,
  coachNotice,
  foldedLine,
  isCheckinCardDay,
  isLowAnswer,
  mondayOf,
  readSnapshot,
  reminderPush,
  sendLabel,
  sentLabel,
  weightChange,
  workoutsValue,
  type CheckinSnapshot,
} from "@/lib/weekly-checkin";
import { WeeklyCheckinForm } from "@/components/athlete/weekly-checkin-form";
import { WeeklyCheckinCard } from "@/components/athlete/weekly-checkin-card";
import { CheckinReviewList } from "@/components/coach/checkin-review-list";
import type { ReviewItem } from "@/lib/weekly-checkin-coach";

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8").replace(/\r\n/g, "\n");

const snap = (over: Partial<CheckinSnapshot> = {}): CheckinSnapshot => ({ workouts_done: 3, workouts_planned: 4, avg_weight: 182.4, prev_avg_weight: 183.6, weight_unit: "lb", food_days: 5, ...over });

describe("which week a check-in is about", () => {
  it("weeks start on Monday", () => {
    expect(mondayOf("2026-11-20")).toBe("2026-11-16"); // Friday
    expect(mondayOf("2026-11-22")).toBe("2026-11-16"); // Sunday
    expect(mondayOf("2026-11-16")).toBe("2026-11-16"); // Monday
  });
  it("on a Monday it is the week that just ended; any other day, this week", () => {
    expect(checkinWeekStart("2026-11-23")).toBe("2026-11-16");
    expect(checkinWeekStart("2026-11-24")).toBe("2026-11-23");
    expect(checkinWeekStart("2026-11-20")).toBe("2026-11-16");
    expect(checkinWeekStart("2026-11-22")).toBe("2026-11-16");
  });
  it("Home shows the card Friday through Monday only", () => {
    const days = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"].map(isCheckinCardDay);
    expect(days).toEqual([true, false, false, false, true, true, true]);
  });
});

describe("the words", () => {
  it("names the coach by first name, and a title is not a name", () => {
    expect(coachLabel("Ron Arnold")).toBe("Coach Ron");
    expect(coachLabel("Coach Ron")).toBe("Coach Ron");
    expect(coachLabel("Coach")).toBe("your coach");
    expect(coachLabel(null)).toBe("your coach");
    expect(checkinSubline("2026-11-16", "Ron Arnold")).toBe("Week of Nov 16 · for Coach Ron");
    expect(sendLabel("Ron Arnold")).toBe("Send to Coach Ron");
    expect(sendLabel(null)).toBe("Send to your coach");
  });
  it("workouts read N of M, or just N when nothing was planned by date", () => {
    expect(workoutsValue(snap())).toBe("3 of 4");
    expect(workoutsValue(snap({ workouts_planned: 0 }))).toBe("3");
  });
  it("the weight change has one decimal and a real minus sign, and needs both weeks", () => {
    expect(weightChange(snap())).toBe("−1.2");
    expect(weightChange(snap({ avg_weight: 184.4 }))).toBe("+0.8");
    expect(weightChange(snap({ avg_weight: 183.6 }))).toBe("0.0");
    expect(weightChange(snap({ prev_avg_weight: null }))).toBeNull();
    expect(weightChange(snap({ avg_weight: null }))).toBeNull();
  });
  it("averages a week's weigh-ins to one decimal, and none is none", () => {
    expect(averageWeight([182, "183.1", 182.4])).toBe(182.5);
    expect(averageWeight([])).toBeNull();
    expect(averageWeight([null, "", 0])).toBeNull();
  });
  it("a 1 to 5 answer of 2 or less is the coral chip", () => {
    expect([1, 2, 3, 5].map(isLowAnswer)).toEqual([true, true, false, false]);
  });
  it("says when it was sent, in the coach's zone", () => {
    const now = new Date("2026-11-20T18:00:00Z");
    expect(sentLabel("2026-11-20T13:14:00Z", "America/New_York", now)).toBe("Sent today, 8:14 AM");
    expect(sentLabel("2026-11-19T23:02:00Z", "America/New_York", now)).toBe("Sent yesterday, 6:02 PM");
    expect(sentLabel("2026-11-19T23:02:00Z", "America/New_York", now, false)).toBe("Sent yesterday");
    expect(sentLabel("2026-11-17T15:00:00Z", "America/New_York", now)).toBe("Sent Tue, Nov 17, 10:00 AM");
    expect(foldedLine({ submittedAt: "2026-11-19T23:02:00Z", energy: 5, eating: 4 }, "America/New_York", now)).toBe("Sent yesterday · Energy 5 · Eating 4");
  });
  it("the coach's notice and the reminder are plain", () => {
    expect(coachNotice("Ann Lee")).toEqual({ title: "Ann Lee sent their weekly check-in", body: "Open Check-ins to read it and reply.", notice: "Ann Lee sent their weekly check-in." });
    expect(reminderPush("Ron Arnold").body).toBe("Coach Ron would like your check-in for this week. It takes about a minute.");
  });
});

describe("what a client may send", () => {
  it("needs both answers as whole numbers from 1 to 5", () => {
    expect(cleanCheckin({ energy: 4 }).ok).toBe(false);
    expect(cleanCheckin({ energy: 0, eating: 3 }).ok).toBe(false);
    expect(cleanCheckin({ energy: 4.5, eating: 3 }).ok).toBe(false);
    expect(cleanCheckin({ energy: "4", eating: 3 }).ok).toBe(false);
  });
  it("trims the texts (blank is none), caps them, and keeps up to six real photo ids", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const r = cleanCheckin({ energy: 4, eating: 2, win: "  PR on squat ", hard: "   ", photoIds: [id, id, "x", ...Array.from({ length: 8 }, (_, i) => `2222222${i}-1111-4111-8111-111111111111`)] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.win).toBe("PR on squat");
    expect(r.value.hard).toBeNull();
    expect(r.value.photo_ids[0]).toBe(id);
    expect(r.value.photo_ids.length).toBe(6);
    expect(cleanCheckin({ energy: 1, eating: 5, win: "x".repeat(5000) }).ok && (cleanCheckin({ energy: 1, eating: 5, win: "x".repeat(5000) }) as { value: { win: string } }).value.win.length).toBe(2000);
  });
  it("reads a stored snapshot safely", () => {
    expect(readSnapshot(null)).toEqual({ workouts_done: 0, workouts_planned: 0, avg_weight: null, prev_avg_weight: null, weight_unit: "lb", food_days: 0 });
    expect(readSnapshot({ workouts_done: 2, workouts_planned: 3, avg_weight: 80.2, weight_unit: "kg", food_days: 9 })).toMatchObject({ workouts_done: 2, avg_weight: 80.2, weight_unit: "kg", food_days: 7 });
  });
});

describe("the client's screen (the approved phone board)", () => {
  const base = { groupId: "g1", athleteId: "a1", coachName: "Ron Arnold", snapshot: snap(), initial: null, reviewed: false };
  it("shows the card filled in from the logs, the two 1 to 5 rows, the two boxes, photos and the big button", () => {
    const html = renderToStaticMarkup(createElement(WeeklyCheckinForm, base));
    for (const t of ["Workouts", "3 of 4", "Avg weight", "182.4 lb", "Days logged food", "5 of 7", "Filled in from your logs. Answer the rest in about a minute.", "How was your energy this week?", "How well did you stick to your eating?", "Biggest win this week", "What was hard?", "(optional)", "+ Add progress photos (optional)", "Send to Coach Ron"]) {
      expect(html, t).toContain(t);
    }
    // 44px answer buttons, ten of them, none picked yet
    expect(html.match(/role="radio"/g)?.length).toBe(10);
    expect(html.match(/w-11 h-11/g)?.length).toBe(10);
    expect(html).not.toContain('aria-checked="true"');
    expect(html).toContain("rounded-token-pill bg-rust text-graphite");
  });
  it("hides the average weight when none was logged, and shows a picked answer filled", () => {
    const html = renderToStaticMarkup(createElement(WeeklyCheckinForm, { ...base, snapshot: snap({ avg_weight: null }), initial: { energy: 4, eating: 2, win: "", hard: "", photos: [] } }));
    expect(html).not.toContain("Avg weight");
    expect(html.match(/aria-checked="true"/g)?.length).toBe(2);
    expect(html).toMatch(/aria-checked="true"[^>]*class="[^"]*bg-rust text-graphite/);
  });
  it("once the coach reviewed it, it is shown, not sent again", () => {
    const html = renderToStaticMarkup(createElement(WeeklyCheckinForm, { ...base, initial: { energy: 4, eating: 2, win: "PR", hard: "", photos: [] }, reviewed: true }));
    expect(html).toContain("Coach Ron reviewed this check-in.");
    expect(html).not.toContain("Send to Coach Ron");
    expect(html).not.toContain("+ Add progress photos");
  });
  it("the Home card opens the check-in", () => {
    const html = renderToStaticMarkup(createElement(WeeklyCheckinCard, { groupId: "g1", coachName: "Ron Arnold" }));
    expect(html).toContain(`href="${checkinPath("g1")}"`);
    expect(html).toContain("Your weekly check-in");
    expect(html).toContain("It goes to Coach Ron.");
  });
});

describe("the coach's Check-ins (the approved board)", () => {
  const item = (over: Partial<ReviewItem> = {}): ReviewItem => ({
    id: "c1",
    groupId: "g1",
    athleteId: "a1",
    name: "Ann Lee",
    weekStart: "2026-11-16",
    energy: 4,
    eating: 2,
    win: "Squatted 185",
    hard: "Late nights",
    photoIds: [],
    snapshot: snap(),
    submittedAt: "2026-11-20T13:14:00Z",
    ...over,
  });
  const props = {
    items: [item(), item({ id: "c2", athleteId: "a2", name: "Bo Diaz", energy: 5, eating: 4, submittedAt: "2026-11-19T23:02:00Z" })],
    photos: {},
    coach: { id: "coach", name: "Ron Arnold" },
    timeZone: "America/New_York",
    nowIso: "2026-11-20T18:00:00Z",
    weekStart: "2026-11-16",
    notSentCount: 3,
  };
  it("heads with the count, opens the first one as a card with its chips, win and hard, the reply and both buttons", () => {
    const html = renderToStaticMarkup(createElement(CheckinReviewList, props));
    for (const t of ["Check-ins", "2 to review", "Ann Lee", "Sent today, 8:14 AM", "Workouts 3 of 4", "Energy 4", "Eating 2", "Weight −1.2", "Win:", "Squatted 185", "Hard:", "Late nights", "Your reply", "Send and mark reviewed", "Reviewed"]) {
      expect(html, t).toContain(t);
    }
    expect(html).toContain('class="text-win font-semibold">Win:');
    expect(html).toContain('class="text-alert font-semibold">Hard:');
    // the low eating answer is the coral chip, the energy one is not
    expect(html).toContain('tint-alert">Eating 2');
    expect(html).toContain('bg-surface-2">Energy 4');
    expect(html).toContain("data-initials-avatar");
  });
  it("folds the others into rows that open, and the footer offers the reminder", () => {
    const html = renderToStaticMarkup(createElement(CheckinReviewList, props));
    expect(html).toContain("Bo Diaz");
    expect(html).toContain("Sent yesterday · Energy 5 · Eating 4");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Not sent yet this week: 3 clients");
    expect(html).toContain("Remind them");
  });
  it("with nothing waiting it says so, and with everyone sent there is nothing to remind", () => {
    const html = renderToStaticMarkup(createElement(CheckinReviewList, { ...props, items: [], notSentCount: 0 }));
    expect(html).toContain("You&#x27;re caught up. No check-ins to review.");
    expect(html).not.toContain("to review</span>");
    expect(html).toContain("Everyone has sent this week&#x27;s check-in.");
  });
});

describe("how it is wired", () => {
  it("the client's send is written with their own session and tells the coach once, through their Client activity switch", () => {
    const route = read("app/api/checkins/route.ts");
    expect(route).toContain('await supabase.from("weekly_checkins").insert(');
    expect(route).toContain('await supabase.from("weekly_checkins").update(fields)');
    expect(route).not.toMatch(/db\.from\("weekly_checkins"\)/);
    expect(route).toContain("if (!existing.row && coach) {");
    expect(route).toContain('type: "weekly_checkin"');
    expect(route).toContain('sendCoachPush(db, coach.id, "client_activity"');
    // the numbers come from the logs on the server, never from the browser
    expect(route).toContain("loadCheckinSnapshot(supabase,");
    expect(route).not.toMatch(/body\.(auto_snapshot|snapshot)/);
  });
  it("the coach's reply goes through the one direct-message send, and the review is the coach's own write", () => {
    const list = read("components/coach/checkin-review-list.tsx");
    expect(list).toContain("sendDirectMessage(createBrowserClient(), { groupId: item.groupId, senderId: coach.id");
    expect(list).toContain('.from("weekly_checkins")');
    expect(list).toContain("reply_message_id: replyMessageId");
    expect(list).toContain("confirmDialog({");
  });
  it("the reminder is worked out on the server, once a day, and each client's quiet hours apply", () => {
    const route = read("app/api/checkins/remind/route.ts");
    expect(route).toContain("rateLimitAllows(`checkin-remind:${user.id}`, 1, REMIND_LIMIT_SECONDS)");
    expect(route.indexOf("data.notSent.length === 0")).toBeLessThan(route.indexOf("rateLimitAllows("));
    expect(route).toContain("sendPushToProfile(db, c.id,");
    expect(route).not.toContain("ignoreQuiet");
    expect(read("lib/send-push.ts")).toContain("if (!opts.ignoreQuiet && isQuietNow(prefs)) return 0;");
  });
  it("the client finds it on Home and any time at its own page; the coach from Clients and the notice", () => {
    const home = read("app/(coach)/groups/[groupId]/page.tsx");
    expect(home).toContain("{isToday && checkinCard && <WeeklyCheckinCard");
    expect(read("app/(coach)/groups/[groupId]/check-in/page.tsx")).toContain('membership?.role !== "athlete"');
    expect(read("app/(coach)/clients/page.tsx")).toContain("<CheckinsLink count={checkinCount} />");
    expect(read("app/(coach)/groups/[groupId]/clients/page.tsx")).toContain("<CheckinsLink count={checkinCount} />");
  });
});
