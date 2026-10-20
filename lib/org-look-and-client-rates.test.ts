import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ScheduleCard } from "@/components/athlete/schedule-card";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

// Ron, Oct 19: "One thing I'm not seeing is where I customize my organization colors and all of that stuff."
describe("Settings: Organization look", () => {
  const src = read("app/(coach)/groups/[groupId]/settings/page.tsx");
  it("a link to colors, logo and fonts, only for a coach who can edit branding (owner or admin of this group's organization), not on the phone", () => {
    expect(src).toContain('<SettingsGroup label="Organization look">');
    expect(src).toContain("href={`/groups/${params.groupId}/branding?tab=branding`}");
    expect(src).toContain("Colors, logo and fonts →");
    expect(src).toMatch(/\{canEditBranding && \(\n\s*<SettingsGroup label="Organization look">/);
    expect(src).toContain("if (isCoach && !effective.isActingAsOther && !(await prefersAthleteStyleView())) {");
    expect(src).toContain('canEditBranding = lookRow?.role === "owner" || lookRow?.role === "admin";');
  });
  it("a client never gets it (isCoach is the client's own role in this group)", () => {
    expect(src).toContain('const isCoach = membership?.role === "coach";');
    expect(src).toContain("let canEditBranding = false;");
  });
  it("the Business menu item says what it holds", () => {
    expect(read("components/coach/coach-desktop-shell.tsx")).toContain('label: "Organization (colors, team, plan)"');
  });
});

// Ron, Oct 19: "the client rates should be collapsible."
describe("Business: Client rates folds", () => {
  const src = read("app/(coach)/groups/[groupId]/business/page.tsx");
  const block = src.slice(src.indexOf("<details className=\"group\" data-client-rates>"), src.indexOf("</details>", src.indexOf("data-client-rates")));
  it("closed by default", () => {
    expect(block.length).toBeGreaterThan(0);
    expect(block.split("\n")[0]).not.toContain(" open");
  });
  it("the summary keeps the swappable term and shows how many clients and how many rates are set", () => {
    const summary = block.slice(block.indexOf("<summary"), block.indexOf("</summary>"));
    expect(summary).toContain('<SwappableTerm termKey="client" form="singular" className="capitalize" /> rates');
    expect(summary).toContain("{clients.length}");
    expect(summary).toContain("c.monthlyRate != null && c.monthlyRate > 0).length} set");
    expect(summary).toContain("<ChevronDown");
  });
  it("the explanation and the list are inside", () => {
    expect(block).toContain("Set what each client actually pays");
    expect(block).toContain("<ClientRateEditor");
  });
});

describe("View as client: the Schedule card, read only", () => {
  it("the preview's Calendar tab shows the same card with the button switched off", () => {
    const src = read("app/(coach)/groups/[groupId]/athletes/[athleteId]/view/page.tsx");
    expect(src).toContain("{schedule && <ScheduleCard available={schedule.available} href={schedule.href} preview />}");
    const html = renderToStaticMarkup(createElement(ScheduleCard, { available: 4, href: "/x", preview: true }));
    expect(html).toContain("4 sessions available");
    expect(html).toContain('disabled=""');
    expect(html).toContain('title="Your client taps this"');
    expect(html).not.toContain("href=");
  });
  it("decided the same way as the client's own Calendar (no policy row = I schedule everyone)", () => {
    const src = read("lib/schedule-card.ts");
    expect(src).toContain('const bookingMode = sb.error ? "free" : ((sb.data?.booking_mode as string | null) ?? "coach_schedules");');
    expect(src).toContain("available: picture.toBook");
  });
});
