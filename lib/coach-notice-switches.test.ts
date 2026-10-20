import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { KIND_IDS, NOTICE_KINDS, kindFromPushUrl, kindOfType } from "@/lib/coach-notice-kinds";
import { NoticeSwitches } from "@/components/coach/notice-switches";

vi.mock("@/lib/supabase/client", () => ({ createBrowserClient: () => ({}) }));

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

describe("the kinds of notice a coach can switch", () => {
  it("has a plain label and a one-line example for each, and no type belongs to two kinds", () => {
    expect(NOTICE_KINDS.map((k) => k.id)).toEqual(["low_sessions", "bookings", "messages", "client_activity", "milestones", "requests", "session_notes", "payments", "briefing", "team"]);
    for (const k of NOTICE_KINDS) {
      expect(k.label.length, k.id).toBeGreaterThan(3);
      expect(k.example.endsWith("."), k.id).toBe(true);
    }
    const seen = new Set<string>();
    for (const t of NOTICE_KINDS.flatMap((k) => k.types)) {
      expect(seen.has(t), t).toBe(false);
      seen.add(t);
    }
  });
  it("the database's type -> kind list is exactly this list (migration 0423 and lib/coach-notice-kinds.ts never drift)", () => {
    const sql = read("supabase/migrations/0423_coach_notice_switches.sql");
    const inSql = [...sql.matchAll(/when '([a-z_]+)' then '([a-z_]+)'/g)].map((m) => `${m[1]}:${m[2]}`).sort();
    const inCode = NOTICE_KINDS.flatMap((k) => k.types.map((t) => `${t}:${k.id}`)).sort();
    expect(inSql).toEqual(inCode);
    expect(kindOfType("direct_message")).toBe("messages");
    expect(kindOfType("organization_invite")).toBeNull();
    expect(kindOfType("coach_account_closed")).toBeNull();
  });
  it("the important notices cannot be switched off", () => {
    for (const t of ["organization_invite", "space_invite", "coach_account_closed", "email_change_requested", "email_changed", "email_change_cancelled", "minor_consent_needed", "support_reply", "content_reported", "coach_departure_reminder"]) {
      expect(kindOfType(t), t).toBeNull();
    }
  });
});

describe("a push the browser asks the server to send is judged by the page it opens", () => {
  it("messages, feed, calendar and client pages map to a kind; anything else is not switchable", () => {
    expect(kindFromPushUrl("/groups/g/messages/u")).toBe("messages");
    expect(kindFromPushUrl("/groups/g/feed")).toBe("messages");
    expect(kindFromPushUrl("/groups/g/calendar/2026-10-19")).toBe("bookings");
    expect(kindFromPushUrl("/groups/g/athletes/a")).toBe("client_activity");
    expect(kindFromPushUrl("/groups/g/clients")).toBe("client_activity");
    expect(kindFromPushUrl("/sessions/s1")).toBe("client_activity");
    expect(kindFromPushUrl("/partners/requests")).toBeNull();
    expect(kindFromPushUrl("/")).toBeNull();
    expect(kindFromPushUrl(undefined)).toBeNull();
  });
  it("the route checks the recipient's switch before sending", () => {
    const route = read("app/api/push/send/route.ts");
    expect(route.indexOf("coachNoticeIsOff(db, profileId, kind)")).toBeLessThan(route.indexOf("sendPushToProfile(db, profileId, title, body, url)"));
  });
});

describe("Settings > Notifications", () => {
  it("shows one switch per kind, on by default, with its example, and a switched-off kind reads off", () => {
    const html = renderToStaticMarkup(createElement(NoticeSwitches, { profileId: "p", initialOff: ["low_sessions"], available: true }));
    expect(html.match(/role="switch"/g)?.length).toBe(KIND_IDS.length);
    expect(html.match(/aria-checked="true"/g)?.length).toBe(KIND_IDS.length - 1);
    expect(html.match(/aria-checked="false"/g)?.length).toBe(1);
    expect(html).toContain("Low sessions / renewal window");
    expect(html).toContain("Oliver B. has 1 session left.");
    expect(html).toContain("Each switch controls both the phone notification and the notice in the app.");
  });
  it("is hidden until the database update exists, and only on a coach's own settings", () => {
    expect(renderToStaticMarkup(createElement(NoticeSwitches, { profileId: "p", initialOff: [], available: false }))).toBe("");
    expect(read("app/(coach)/groups/[groupId]/settings/page.tsx")).toContain("{isCoach && !viewingOther && <NoticeSwitches");
  });
  it("saves on tap to the person's own profile row", () => {
    const src = read("components/coach/notice-switches.tsx");
    expect(src).toContain('update({ notices_off: next }).eq("id", profileId)');
  });
});

describe("every coach push goes through the one sender", () => {
  it("no scheduled job or route sends a coach-facing push around the switch", () => {
    for (const f of [
      "app/api/cron/coach-digest/route.ts",
      "lib/notify-payment.ts",
      "lib/payment-events.ts",
      "app/api/session-pattern-check/route.ts",
      "app/api/public-booking/[slug]/book/route.ts",
      "app/api/cron/low-session-digest/route.ts",
      "app/api/cron/milestone-scan/route.ts",
      "app/api/cron/flag-recurring-booking-conflicts/route.ts",
      "app/api/cron/series-top-up/route.ts",
    ]) {
      const s = read(f);
      expect(s, f).toContain("sendCoachPush(");
      expect(s, f).not.toMatch(/\bsendPushToProfile\(/);
    }
  });
  it("no code reads back the id of a notice row it inserted (the trigger may drop the row)", () => {
    for (const f of ["lib/notify-payment.ts", "lib/payment-events.ts", "app/api/session-pattern-check/route.ts", "app/api/cron/milestone-scan/route.ts"]) {
      const s = read(f);
      expect(s, f).not.toMatch(/from\("notifications"\)\s*\.insert\([^)]*\)\s*\.select/);
    }
  });
});
