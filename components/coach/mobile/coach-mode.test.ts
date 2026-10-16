import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, "..", "..", "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("coach mode: a coach logging a workout for a client on the phone", () => {
  it("the frame says whose app it is, keeps the hub button and gives one tap home", () => {
    const bar = read("components/coach/mobile/coach-mode-bar.tsx");
    expect(bar).toContain("Coach mode");
    expect(bar).toContain("Logging for {clientName}");
    expect(bar).not.toContain("You are logging for");
    expect(bar).not.toContain("<Link");
    expect(bar).toContain("<CoachSpotHub groupId={groupId} homeHref={homeHref} compact />");
    expect(read("components/coach/mobile/coach-spot-hub.tsx")).toContain("href={homeHref}");
    expect(bar).toContain("bg-rust");
  });
  it("the log screens carry the frame (the workout, and the which-session and no-program pages)", () => {
    const workout = read("app/(coach)/groups/[groupId]/athletes/[athleteId]/log/[workoutId]/page.tsx");
    expect(workout).toContain("<CoachModeBar");
    expect(workout).toContain("loggedByCoach");
    const list = read("app/(coach)/groups/[groupId]/athletes/[athleteId]/log/page.tsx");
    expect((list.match(/<CoachModeBar/g) ?? []).length).toBe(3);
  });
  it("the coach-logged session screen carries it only for a coach viewing a coach-logged session, and passes the minor flag on", () => {
    const page = read("app/sessions/[sessionId]/page.tsx");
    expect(page).toContain("const coachModeFor = session.logged_by_coach && !isOwnSession && viewerIsCoach;");
    expect(page).toContain("athleteIsMinor(supabase, session.athlete_id)");
    expect(page).toContain("coachMode={coachModeClient ? { homeHref: coachHomeHref, clientIsMinor: coachModeClient.isMinor } : undefined}");
    expect(read("components/logging/session-logger.tsx")).toContain("coachMode={coachMode}");
  });
  it("finishing shows the client's workout card (back to the coach's home only if the card cannot be made), and nothing is posted to the feed for a client under 18", () => {
    const btn = read("components/session/complete-workout-button.tsx");
    expect(btn).toContain("if (announced.href) navHref = announced.href;");
    expect(btn).toContain("else if (coachMode) navHref = coachMode.homeHref;");
    // a coach logging for a client under 18 posts nothing to the feed but still gets the card (the rule itself is in lib/announce-workout-log.ts)
    expect(btn).toContain("skipPost: !!coachMode?.clientIsMinor,");
    expect(btn).not.toContain("skipLink");
    expect(btn).toContain("finishNavigation(existingPost ?");
  });
  it("it never uses the act-as cookie, which would write as the client", () => {
    for (const rel of ["components/coach/mobile/coach-mode-bar.tsx", "app/(coach)/groups/[groupId]/athletes/[athleteId]/log/[workoutId]/page.tsx"]) {
      const src = read(rel);
      expect(src).not.toContain("act-as");
      expect(src).not.toContain("acting_as");
    }
  });
  it("the phone entry points say Log their workout (and the desktop profile does not offer it)", () => {
    expect(read("components/coach/mobile/coach-roster-mobile.tsx")).toContain("Log their workout");
    expect(read("components/coach/mobile/spot-clients-groups-panel.tsx")).toContain("Log their workout");
    const profile = read("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx");
    expect(profile).toContain("Log their workout");
    expect(profile).toContain('className="lg:hidden inline-flex');
    // the desktop profile no longer offers it
    expect(profile).not.toContain("Log an in-person session");
  });
});
