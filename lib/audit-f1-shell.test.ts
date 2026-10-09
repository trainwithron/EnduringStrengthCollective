import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("coach pages sit in the coach shell", () => {
  const settings = read("app/(coach)/groups/[groupId]/settings/page.tsx");
  it("a coach's Settings page uses the coach shell, not the phone client page", () => {
    expect(settings).toContain('active="settings"');
    expect(settings).toContain("const coachDesktop = isCoach && !effective.isActingAsOther;");
    expect(settings).not.toContain("CoachMobileShell");
    // the client's "Back to group" link and client tab bar are for clients only
    expect(settings).toContain("{!coachDesktop && (");
    expect(settings).toContain("{!coachDesktop && <BottomTabBar");
    expect(read("components/coach/coach-desktop-shell.tsx")).toContain('| "settings"');
  });
  it("a coach sees their own blocks first, and no client-only wording", () => {
    expect(settings).toContain("{isCoach ? <>{coachingGroup}{terminologyGroup}{notificationsGroup}</> : notificationsGroup}");
    expect(settings).toContain('audience={isCoach ? "coach" : "client"}');
    expect(settings).toContain("showEmergencyContact={!isCoach}");
    const toggle = read("components/athlete/push-notification-toggle.tsx");
    expect(toggle).toContain('audience === "coach"');
    expect(toggle).toContain("Allow them in your browser");
    expect(read("components/athlete/profile-details-editor.tsx")).toContain("{showEmergencyContact && (");
  });
  it("the Client Versions page is in the shell with a labelled, styled picker", () => {
    const page = read("app/(coach)/groups/[groupId]/workouts/[workoutId]/clients/page.tsx");
    expect(page).toContain("<CoachDesktopShell");
    const picker = read("components/coach/client-picker.tsx");
    expect(picker).toContain("appearance-none");
    expect(picker).toContain("ChevronDown");
    expect(picker).toContain('term("client", "singular", { cap: true })');
  });
  it("Exercise Progressions is in the shell, readable and not stretched", () => {
    const page = read("app/(coach)/groups/[groupId]/programs/[programId]/progressions/page.tsx");
    expect(page).toContain("<CoachDesktopShell");
    expect(page).toContain('className="max-w-4xl pb-10"');
    expect(page).toContain("text-chalk/80 leading-relaxed");
  });
});

describe("the home-screen banner and /calendar", () => {
  it("the 'Add this to your home screen' banner is for phones only and keeps clear of the corner button", () => {
    const src = read("components/add-to-home-screen-prompt.tsx");
    expect(src).toContain('if (detected === "desktop") return unsubscribe;');
    expect(src).toContain("lg:hidden");
    expect(src).toContain("pr-16");
  });
  it("/calendar on its own sends a signed-in person to their calendar", () => {
    const src = read("app/calendar/page.tsx");
    expect(src).toContain("/groups/${membership.group_id}/calendar");
    expect(src).toContain('redirect("/login?next=%2Fcalendar")');
  });
});
