import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatRest, parseRestInput } from "./rest-time";
import { joinView } from "./group-sessions";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("a client's own Rest is m:ss both ways", () => {
  it("90 shows as 1:30 and 1:30 reads back as 90 seconds", () => {
    expect(formatRest(90)).toBe("1:30");
    expect(parseRestInput("1:30")).toEqual({ ok: true, seconds: 90 });
    expect(parseRestInput("")).toEqual({ ok: true, seconds: null });
    expect(parseRestInput("soon")).toEqual({ ok: false });
  });
});

describe("the set grid is phone-sized", () => {
  const grid = read("components/logging/exercise-set-grid.tsx");
  it("cells are 44px tall, the fill handle is wider, and the hint is just the number", () => {
    expect(grid).not.toMatch(/\bh-10\b/);
    expect(grid).toContain('className="relative w-16 h-11 shrink-0"');
    expect(grid).toContain("w-8 h-11 shrink-0");
    expect(grid).not.toContain("(target)");
    expect(grid).not.toContain("lbs`");
    expect(grid).toContain('const placeholder = field === "rest" ? "m:ss" : suggestion');
  });
});

describe("notifications and group sessions on a phone", () => {
  it("the filters and Mark all read are 44px", () => {
    const list = read("components/notifications/notification-list.tsx");
    expect(list).toContain("min-h-11 font-body text-sm px-4 border");
    expect(list).toContain("min-h-11 px-2 font-body text-sm text-steel underline");
  });
  it("the bell opens '/' when a notification has no link, and puts read marks back when saving fails", () => {
    const bell = read("components/athlete/notification-bell.tsx");
    expect(bell).toContain('linkPath: n.link_path ?? "/"');
    expect(bell).toContain("if (updateError) setItems(");
  });
  it("leaving a group session asks first, and its buttons are 44px", () => {
    const list = read("components/athlete/classes-list.tsx");
    expect(list).toContain('action === "leave" && !(await confirmDialog(');
    expect(list.match(/min-h-11/g)?.length).toBe(2);
  });
  it("one name for the feature: Group sessions, not Classes", () => {
    expect(read("app/(coach)/groups/[groupId]/classes/page.tsx")).toContain(">Group sessions</h1>");
    expect(read("lib/nav-intents.ts")).toContain('label: "Group sessions", path: "/groups/{groupId}/classes"');
    expect(read("lib/group-sessions.ts")).not.toMatch(/return "[^"]*class/i);
    expect(read("lib/howto-library.ts")).not.toContain("Classes page");
    expect(joinView({ capacity: 1, joined: 1, mine: null, balance: 5, started: false, cancelled: false }).note).toBe("This group session is full.");
  });
});

describe("small fixes a client meets", () => {
  it("the credit-expiry notice opens the calendar, where the balance shows", () => {
    const cron = read("app/api/cron/expire-session-credits/route.ts");
    expect(cron).not.toContain("/settings");
    expect(cron.match(/\/calendar`/g)?.length).toBe(2);
  });
  it("the first-run guide's dismissed flag is kept per person", () => {
    const card = read("components/athlete/first-run-guide-card.tsx");
    expect(card).toContain("esc-first-run-guide-dismissed-${profileId}");
    expect(card).not.toContain("LOCAL_DISMISS_KEY");
  });
  it("set-password finishes checking only after the agreement lookup is answered", () => {
    const page = read("app/set-password/page.tsx");
    expect(page).toContain("const { data, error: acceptedError } = await supabase");
    expect(page.indexOf("setNeedsLegal(!!acceptedError || !data);")).toBeLessThan(page.lastIndexOf("setChecking(false);"));
  });
});
