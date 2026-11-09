import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LoggedWorkoutCard } from "./logged-workout-card";

const base = { title: "Day 1", dateLabel: "11/2/2026", sessionId: "s1", loggedByCoach: false, volume: 10022, sets: 13, durationSeconds: 3900, prs: [] as string[], exerciseNames: ["Squat", "Bench"] };
const html = (over = {}) => renderToStaticMarkup(createElement(LoggedWorkoutCard, { ...base, ...over }));

describe("a logged workout's short card", () => {
  it("shows what the workout was and the numbers", () => {
    const h = html();
    for (const t of ["Day 1", "10,022", "Lbs lifted", "13", "Sets", "1:05", "HOURS", "Squat, Bench", "/sessions/s1/recap"]) expect(h).toContain(t);
    expect(h).not.toContain("New PR");
  });
  it("counts and names PRs", () => {
    const h = html({ prs: ["Squat", "Bench"] });
    expect(h).toContain("New PRs");
    expect(h).toContain("PR: Squat, Bench");
  });
  it("leaves out a stat with no real number (a forgotten timer, no weight)", () => {
    const h = html({ volume: 0, sets: 3, durationSeconds: 402900 });
    expect(h).not.toContain("Lbs lifted");
    expect(h).not.toContain("HOURS");
    expect(h).toContain("Sets");
  });
});
