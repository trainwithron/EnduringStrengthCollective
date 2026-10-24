import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parqNoticeNeeded } from "@/lib/parq-notice";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const page = read("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx");

// Ron's client profile cleanup: a small message box on Overview, sign-in and personal info in Billing & settings, the injury toggle on Nutrition, one Goals section.
describe("the health screening line", () => {
  it("shows while there are more flagged answers than the coach has acknowledged, and a new one brings it back", () => {
    expect(parqNoticeNeeded(0, null)).toBe(false);
    expect(parqNoticeNeeded(2, null)).toBe(true);
    expect(parqNoticeNeeded(2, undefined)).toBe(true);
    expect(parqNoticeNeeded(2, 0)).toBe(true);
    expect(parqNoticeNeeded(2, 2)).toBe(false);
    expect(parqNoticeNeeded(3, 2)).toBe(true);
    expect(parqNoticeNeeded(1, 2)).toBe(false); // fewer flagged now (the client changed an answer): nothing new to see
  });
  it("Acknowledge saves the number seen on the coach's own row; the line says how many are flagged", () => {
    const notice = read("components/coach/desktop/parq-flag-notice.tsx");
    expect(notice).toContain("Health screening: {flagged} flagged");
    expect(notice).toContain("flagged_count: flagged");
    expect(notice).toContain('.from("athlete_injury_flag_acknowledgements")');
    expect(page).toContain("{parqNotice && <ParqFlagNotice");
    expect(page).toContain("!selfView && parqNoticeNeeded(parQFlaggedCount,");
  });
});

describe("what moved where", () => {
  const overview = page.slice(page.indexOf('<div data-tab="overview" className="space-y-4">'), page.indexOf('<div data-tab="settings" id={SIGN_IN_OPTIONS_ANCHOR}'));
  it("Overview has the message box, the not-signed-in line, the Injured tag and the screening line, and not the sign-in tools or the injury toggle", () => {
    expect(overview).toContain("<OverviewMessageBox");
    expect(overview).toContain("Hasn&apos;t signed in yet.");
    expect(overview).toContain("Sign-in options");
    expect(overview).toContain("?tab=settings");
    expect(overview).toContain("injuryStatusRow?.is_injured");
    expect(overview).toContain(">Injured<");
    expect(overview).not.toContain("<InjuryStatusToggle");
    expect(overview).not.toContain("<CorrectClientEmail");
    expect(overview).not.toContain("<SendSignInLinkButton");
  });
  it("the sign-in panel, the email tools and Personal Info are in Billing & settings", () => {
    const at = (needle: string) => page.lastIndexOf('data-tab="', page.indexOf(needle));
    for (const needle of ["<ClientSignInPanel", "<CorrectClientEmail", "<SendSignInLinkButton", 'title="Personal Info"']) {
      expect(page.slice(at(needle), at(needle) + 20), needle).toContain('data-tab="settings"');
    }
  });
  it("the Currently injured switch is on the Nutrition tab", () => {
    const nutrition = page.slice(page.indexOf('<div data-tab="nutrition"'));
    expect(nutrition).toContain("<InjuryStatusToggle");
    expect(page.indexOf("<InjuryStatusToggle")).toBeGreaterThan(page.indexOf('<div data-tab="nutrition"'));
  });
  it("Messages is not a tab and Programs sits next to Overview", () => {
    expect(page).not.toContain('data-tab="messages"');
    const tabs = read("lib/client-profile-tabs.ts");
    expect(tabs.indexOf('"overview"')).toBeLessThan(tabs.indexOf('key: "program"'));
    expect(tabs).not.toContain('key: "messages"');
  });
});

describe("the message box", () => {
  const box = read("components/coach/desktop/overview-message-box.tsx");
  it("says what the coach needs: new count, the last messages, a reply field, the full conversation", () => {
    for (const text of ["Messages", "{unread} new", "No messages yet.", "Write a reply…", "See full conversation", "Show less"]) expect(box).toContain(text);
  });
  it("the page sends only the last four messages and the unread count, read from the messages it already loads", () => {
    expect(page).toContain("messageRows.slice(0, 4).reverse()");
    expect(page).toContain('.select("id, sender_id, recipient_id, body, created_at, read_at")');
  });
});

describe("one Goals section", () => {
  it("the coach's view is titled Goals and one button offers a smaller goal or their main goal, with the existing forms", () => {
    expect(page).toContain('heading="Goals"');
    expect(page).toContain("mainGoalForm={latestGoalRow?.status !== \"proposed\" ? <GoalProposalForm");
    const section = read("components/shared/sub-goals-section.tsx");
    expect(section).toContain("Add or suggest a goal");
    expect(section).toContain("A smaller goal");
    expect(section).toContain("Suggest their main goal");
    // the client's own page keeps its title and button
    expect(section).toContain("heading = SUB_GOALS_HEADING");
    expect(section).toContain('"Add a smaller goal"');
  });
  it("the separate Suggest a goal block is gone for a coach (their own profile keeps Set a goal)", () => {
    expect(page).toContain("{selfView && latestGoalRow?.status !== \"proposed\" && (");
  });
});

describe("the paste", () => {
  it("is one column on the existing row, nothing else", () => {
    const sql = read("supabase/migrations/0376_parq_acknowledged_count.sql");
    expect(sql).toContain("add column if not exists flagged_count integer");
    expect((sql.match(/create table/gi) ?? []).length).toBe(0);
  });
});
