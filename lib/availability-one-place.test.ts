import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BookingModeSelect } from "@/components/coach/desktop/booking-mode-select";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("Availability has ONE home: Calendar > Availability", () => {
  it("the old group-level page only sends the coach there", () => {
    const page = read("app/(coach)/groups/[groupId]/availability/page.tsx");
    expect(page).toContain('redirect("/calendar?tab=availability")');
    expect(page).not.toMatch(/BookingModeSelect|AvailabilityManagerDesktop|BookingPolicyControl|createServerClient/);
  });
  it("no menu, hub, link or helper still points at the old page", () => {
    const offenders: string[] = [];
    for (const f of [...sourceFiles("app"), ...sourceFiles("components"), ...sourceFiles("lib")]) {
      if (/availability\/page\.tsx$/.test(f.replace(/\\/g, "/"))) continue;
      const s = read(f);
      if (/\/groups\/(\$\{[^}]+\}|\{groupId\})\/availability["`'?]/.test(s)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
  it("the Calendar's Availability tab carries every control the old page had, in this order: how clients book, booking rules, time zone, recurring hours, time off", () => {
    const settings = read("components/coach/desktop/availability-settings.tsx");
    const order = ["<BookingModeSelect", "<BookingPolicyControl", "<ExpiryHeadsUpControl", "<ReupNudgeToggle", "<TimezoneControl"].map((x) => settings.indexOf(x));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(settings).toContain("<AvailabilityExceptionsManager");
    const tabs = read("components/coach/desktop/calendar-page-tabs.tsx");
    expect(tabs.indexOf("{settingsSlot}")).toBeLessThan(tabs.indexOf("<AvailabilityManagerDesktop"));
    expect(tabs.indexOf("<AvailabilityManagerDesktop")).toBeLessThan(tabs.indexOf("{timeOffSlot}"));
    expect(tabs).toContain("sessionTypeEnabled={sessionTypeEnabled}");
    const body = read("components/coach/calendar-page-body.tsx");
    expect(body).toContain("settingsSlot={<AvailabilityBookingSettings coachId={user.id} />}");
    expect(body).toContain("timeOffSlot={<AvailabilityTimeOff coachId={user.id} />}");
    expect(body).toContain("Let clients book:");
  });
  it("a phone coach asking for the tab gets the full page (the one place availability lives)", () => {
    expect(read("app/(coach)/calendar/page.tsx")).toContain('searchParams.tab !== "availability"');
    expect(read("components/coach/calendar-page-body.tsx")).toContain('searchParams.tab !== "availability"');
  });
});

describe("How clients book: three large choices, the current one visibly selected, saved on tap", () => {
  it("renders three radio choices with exactly one selected, and shows the default when the coach never chose", () => {
    const html = renderToStaticMarkup(createElement(BookingModeSelect, { coachId: "c1", initialMode: "coach_schedules" }));
    expect(html.match(/role="radio"/g)?.length).toBe(3);
    expect(html.match(/aria-checked="true"/g)?.length).toBe(1);
    expect(html).toMatch(/aria-checked="true"[^>]*>(?:(?!<\/button>).)*I schedule everyone/s);
    expect(html).toContain("How clients book");
  });
  it("saves the moment one is tapped and says Saved", () => {
    const src = read("components/coach/desktop/booking-mode-select.tsx");
    expect(src).toContain("onClick={() => choose(o.value)}");
    expect(src).toContain('upsert({ coach_id: coachId, booking_mode: next }');
    expect(src).toContain("Saved");
  });
});

describe("session length is typed, not picked", () => {
  const src = read("components/coach/desktop/availability-manager-desktop.tsx");
  it("one number field and Save for all your hours; no chips, no 'Same as the slot' button", () => {
    expect(src).toContain("Session length (minutes)");
    expect(src).toContain("minutes > 240");
    expect(src).not.toContain("const PRESETS");
    expect(src).not.toContain("Same as the slot");
    expect(src).not.toContain("Other session length in minutes");
  });
  it("the Add window form has ONE input for the slot step and ONE for the session length (empty = same as the slot)", () => {
    expect(src).not.toContain("StepPresets");
    expect(src).toContain("Empty = the same as the slot.");
    expect(src.match(/Slot every \(min\)/g)?.length).toBe(1);
  });
});
