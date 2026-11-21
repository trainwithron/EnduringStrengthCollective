import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/supabase/client", () => ({ createBrowserClient: () => ({}) }));

import { TodayTiles } from "@/components/athlete/today-tiles";
import { WeightLogWidget, savedWeightLine } from "@/components/athlete/weight-log-widget";
import { InbodyEntry } from "@/components/body/inbody-entry";
import { HomeSheet } from "@/components/athlete/home-sheet";
import { kgToLb } from "@/lib/units";

// Ron, Nov 21 (from using the app): the three tiles on a client's Home only scrolled the page a little. Each now OPENS its thing in a pop-up over Home.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("the three tiles open pop-ups, not places further down the page", () => {
  const html = renderToStaticMarkup(createElement(TodayTiles));
  it("are three buttons that say they open a dialog; none is a link to a spot on the page", () => {
    expect(html.match(/<button type="button" aria-haspopup="dialog"/g)?.length).toBe(3);
    expect(html).not.toContain("<a ");
    expect(html).not.toContain('href="#');
    for (const t of ["checkin", "weight", "inbody"]) expect(html).toContain(`data-tile="${t}"`);
  });
  it("each tile takes focus (so it gets it back) and asks its owner to open", () => {
    const tiles = read("components/athlete/today-tiles.tsx");
    expect(tiles).toContain("e.currentTarget.focus();");
    expect(tiles).toContain("openFromTile(e, OPEN_CHECKIN_EVENT)");
    expect(tiles).toContain("openFromTile(e, OPEN_WEIGHT_EVENT)");
    expect(tiles).toContain("openFromTile(e, OPEN_INBODY_EVENT)");
    expect(read("components/athlete/wellness-checkin-popup.tsx")).toContain("window.addEventListener(OPEN_CHECKIN_EVENT, open);");
    expect(read("components/athlete/weight-log-widget.tsx")).toContain("window.addEventListener(OPEN_WEIGHT_EVENT, open);");
    expect(read("components/body/inbody-entry.tsx")).toContain("window.addEventListener(OPEN_INBODY_EVENT, openIt);");
  });
  it("nothing scrolls any more", () => {
    for (const f of ["components/athlete/today-tiles.tsx", "components/athlete/wellness-checkin-popup.tsx", "components/athlete/weight-log-widget.tsx", "components/body/inbody-entry.tsx"]) {
      expect(read(f), f).not.toContain("scrollIntoView");
    }
  });
  it("only the weight log on Home listens for its tile", () => {
    expect(read("components/athlete/day-card.tsx")).toContain("weightUnit={weightUnit} opensFromTile />");
    expect(read("components/athlete/set-my-targets-card.tsx")).not.toContain("opensFromTile");
  });
});

describe("the pop-up", () => {
  type SheetProps = Parameters<typeof HomeSheet>[0];
  const drawn = (open: boolean, title: string) => renderToStaticMarkup(createElement(HomeSheet, { open, title, onClose: () => {} } as SheetProps, "inside"));
  const html = drawn(true, "Log weight");
  it("is a named modal dialog with a 44px close button", () => {
    expect(html).toContain('role="dialog" aria-modal="true" aria-label="Log weight"');
    expect(html).toContain('aria-label="Close" class="h-11 w-11');
    expect(html).toContain("inside");
    expect(drawn(false, "x")).toBe("");
  });
  it("keeps focus inside, closes on Escape, the close button or a tap outside, and gives focus back to the tile", () => {
    const s = read("components/athlete/home-sheet.tsx");
    expect(s).toContain("useDialogA11y<HTMLDivElement>(open, onClose, undefined, { guard })");
    expect(s).toContain("return () => document.querySelector<HTMLElement>(returnFocusTo)?.focus();");
    expect(s).toContain("if (e.target === e.currentTarget) requestClose();");
    expect(read("components/athlete/wellness-checkin-popup.tsx")).toContain(`returnFocusTo='[data-tile="checkin"]'`);
    expect(read("components/athlete/weight-log-widget.tsx")).toContain(`returnFocusTo='[data-tile="weight"]'`);
    expect(read("components/body/inbody-entry.tsx")).toContain(`returnFocusTo='[data-tile="inbody"]'`);
  });
});

describe("Check in", () => {
  const p = read("components/athlete/wellness-checkin-popup.tsx");
  it("opens the same one-question-at-a-time check-in in the pop-up, answered or skipped or not", () => {
    expect(p).toContain("if (opened) {");
    expect(p).toContain('<HomeSheet open title="Wellness check-in" showTitle={false} onClose={() => setOpened(false)}');
    // the same widget, so the same save
    expect(p.match(/<WellnessCheckinWidget/g)?.length).toBe(1);
    expect(p).toContain("if (!opened && (checkin || dismissed || snoozed)) return null;");
  });
});

describe("Log weight", () => {
  const sheet = (unit: "lb" | "kg") =>
    renderToStaticMarkup(createElement(WeightLogWidget, { athleteId: "a", groupId: "g", initialLogs: [], weightUnit: unit, opensFromTile: true, initialSheetOpen: true }));
  it("one number box for a decimal, in the client's unit, with Save and Cancel", () => {
    const html = sheet("lb");
    expect(html).toContain('aria-label="Log weight"');
    expect(html).toContain("Today&#x27;s weight in lb");
    expect(html.match(/<input /g)?.length).toBe(1);
    expect(html).toContain('inputMode="decimal"');
    expect(html).toContain(">Save</button>");
    expect(html).toContain(">Cancel</button>");
    expect(sheet("kg")).toContain("Today&#x27;s weight in kg");
  });
  it("the box is focused as it opens (the keyboard comes up), and it is the weight log's own save", () => {
    const w = read("components/athlete/weight-log-widget.tsx");
    expect(w).toMatch(/inputMode="decimal"\n\s+enterKeyHint="done"\n\s+autoComplete="off"\n\s+autoFocus/);
    expect(w).toContain("flushSync(() => {");
    expect(w).toContain("const saved = await saveWeight(sheetWeight);");
    expect(w).toContain("const saved = await saveWeight(weight);");
    expect(w.match(/\.from\("body_weight_logs"\)\s*\.upsert/g)?.length).toBe(1);
  });
  it('then says "Saved: 182.4 lb" and closes', () => {
    expect(savedWeightLine(182.4, "lb")).toBe("Saved: 182.4 lb");
    expect(savedWeightLine(kgToLb(82.5), "kg")).toBe("Saved: 82.5 kg");
    const w = read("components/athlete/weight-log-widget.tsx");
    expect(w).toContain("setSheetSaved(savedWeightLine(saved, weightUnit));");
    expect(w).toContain("if (!milestone) closeTimer.current = setTimeout(() => setSheetOpen(false), SAVED_CLOSE_MS);");
  });
  it("is not drawn at all on a weight log that does not open from the tile", () => {
    const html = renderToStaticMarkup(createElement(WeightLogWidget, { athleteId: "a", groupId: "g", initialLogs: [], initialSheetOpen: true }));
    expect(html).not.toContain('role="dialog"');
  });
});

describe("InBody", () => {
  const html = renderToStaticMarkup(createElement(InbodyEntry, { athleteId: "a", groupId: "g", initialSheetOpen: true }));
  it("opens Take a photo (the camera) or Upload a photo (the phone's photos), with the same outside-AI line", () => {
    expect(html).toContain('aria-label="InBody scan"');
    expect(html).toContain("Take a photo");
    expect(html).toContain("Upload a photo");
    expect(html).toContain("data-ai-disclosure");
    expect(html).toContain("outside AI service");
    const inputs = html.match(/<input [^>]*>/g) ?? [];
    expect(inputs).toHaveLength(2);
    expect(inputs.filter((i) => i.includes('accept="image/*"'))).toHaveLength(2);
    expect(inputs.filter((i) => i.includes('capture="environment"'))).toHaveLength(1);
  });
  it("goes on into the same reading, and closing asks first only while numbers are being checked", () => {
    const e = read("components/body/inbody-entry.tsx");
    expect(e).toContain("<InbodyScanFlow");
    expect(e).toContain('guard={() => (step.current === "review" ? "ask" : step.current === "pick" ? "close" : "block")}');
    expect(read("components/body/inbody-scan-flow.tsx")).toContain('fetch("/api/ai/parse-inbody-scan"');
  });
});
