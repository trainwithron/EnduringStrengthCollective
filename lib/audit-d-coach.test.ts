import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { displayFor } from "./grocery-list";
import { readableDay } from "./away-reply";
import { describeConfirm } from "./confirm-store";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("package manager", () => {
  const src = read("components/coach/desktop/package-manager.tsx");
  it("deactivating asks first, checks the answer and shows the error; the Published/Private toggle too", () => {
    expect(src).toContain('confirmLabel: "Deactivate"');
    expect(src.match(/if \(res\.ok\) \{/g)?.length).toBe(2);
    expect(src).toContain("setRowError(");
    expect(src).toContain('role="alert"');
  });
});

describe("assigning a program from a client's profile", () => {
  it("has the same start-date field as the Programs page, and one name", () => {
    const menu = read("components/coach/client-programming-menu.tsx");
    expect(menu).toContain("startDate: startDate || undefined");
    expect(menu).toContain("Start date");
    expect(menu).toContain("Assign program\n");
    expect(read("components/coach/desktop/program-card-menu.tsx")).toContain("Assign program\n");
    expect(read("components/coach/desktop/program-card-menu.tsx")).not.toContain("Assign to Client\n");
  });
});

describe("the away reply card", () => {
  it("writes a day as a person says it", () => {
    expect(readableDay("2026-10-12")).toBe("Oct 12");
    expect(readableDay("2026-01-05")).toBe("Jan 5");
    expect(readableDay("nonsense")).toBe("nonsense");
  });
  it("starts the form with no last day once the reply has ended, and shows readable days", () => {
    const src = read("components/coach/away-reply-card.tsx");
    expect(src).toContain('awayReplyState(initial, today) === "ended" ? ""');
    expect(src).toContain("readableDay(setting.endsOn)");
  });
});

describe("sign-in link wording and the program label control", () => {
  it("one name, 'sign-in link', and a new one asks first", () => {
    const panel = read("components/coach/client-signin-panel.tsx");
    expect(panel).not.toMatch(/[Ii]nvite link/);
    expect(panel).toContain("Make a new sign-in link? The old one stops working.");
    expect(read("lib/client-claim.ts")).toContain('invite_created: "Sign-in link created"');
  });
  it("the program order is 1 to 99, in plain words when labels are off", () => {
    const src = read("components/coach/program-role-control.tsx");
    expect(src).toContain("parsedOrder < 1 || parsedOrder > 99");
    expect(src).toContain("from 1 to 99");
    expect(src).not.toContain("after the next database update");
  });
  it("the bare-number Rest question has a Save button", () => {
    expect(read("components/coach/exercise-builder-card.tsx")).toContain('confirmLabel: "Save" })) return false;');
  });
});

describe("the coach's own word for clients", () => {
  it("the mobile tab, hub panels and group-session text use the chosen word", () => {
    expect(read("components/athlete/bottom-tab-bar.tsx")).toContain('term("client", "plural", { cap: true })');
    expect(read("components/coach/mobile/quick-payment-panel.tsx")).toContain('term("client", "plural")');
    expect(read("components/coach/mobile/spot-builder-panel.tsx")).toContain('Pick a {term("client")}');
    expect(read("components/coach/mobile/spot-clients-groups-panel.tsx")).toContain('term("client", "plural", { cap: true })');
    expect(read("components/coach/desktop/group-sessions-manager.tsx")).toContain('Add a {term("client")}');
    const grid = read("components/coach/desktop/client-card-grid.tsx");
    expect(grid).not.toMatch(/selected athletes/);
    expect(grid).toContain('`Make ${t("client")}`');
    expect(read("app/(coach)/groups/[groupId]/athletes/[athleteId]/calendar/[date]/page.tsx")).toContain('<SwappableTerm termKey="client" cap />');
  });
});

describe("confirm questions", () => {
  it("a later sentence that says what is NOT touched does not make a harmless question red", () => {
    expect(describeConfirm("Move your session to Mon, Oct 12? Nothing is cancelled or removed.").destructive).toBe(false);
    expect(describeConfirm("Cancel this link? Anyone who has it can no longer join.").destructive).toBe(true);
  });
  it("money and schedule questions name their action instead of 'Confirm'", () => {
    const pairs: [string, string][] = [
      ["components/coach/assign-sessions-control.tsx", 'confirmLabel: "Set balance"'],
      ["components/coach/session-credits-control.tsx", 'confirmLabel: "Remove session"'],
      ["components/coach/correct-client-email.tsx", 'confirmLabel: "Change email"'],
      ["components/coach/desktop/bulk-macro-range-form.tsx", 'confirmLabel: "Apply targets"'],
      ["components/coach/desktop/meal-plan-generator.tsx", 'confirmLabel: "Build plan"'],
      ["components/coach/desktop/needs-payment-panel.tsx", 'confirmLabel: "Put on hold"'],
      ["components/coach/mark-attended-control.tsx", "confirmLabel: \"Don't charge\""],
      ["components/public/manage-booking-flow.tsx", 'confirmLabel: "Move it"'],
      ["components/athlete/cancel-booking-button.tsx", 'confirmLabel: "Yes, cancel"'],
    ];
    for (const [file, snippet] of pairs) expect(read(file), file).toContain(snippet);
  });
});

describe("small fixes", () => {
  it("a grocery weight never reads '16.0 oz' after the pounds", () => {
    const text = displayFor("Chicken Breast", 906, "g", false);
    expect(text).toContain("(2 lb)");
    expect(text).not.toContain("16.0 oz");
    expect(displayFor("Chicken Breast", 1400, "g", false)).toContain("(3 lb 1.4 oz)");
  });
  it("the plan-retry refusal speaks as 'We'", () => {
    expect(read("app/api/nutrition/plan-retry/route.ts")).toContain("We couldn't find meals that fit all of that.");
  });
  it("the youth-mode toggle says when a save failed", () => {
    expect(read("components/coach/desktop/nutrition-youth-mode-toggle.tsx")).toContain("That didn't save. The setting is back where it was.");
  });
});
