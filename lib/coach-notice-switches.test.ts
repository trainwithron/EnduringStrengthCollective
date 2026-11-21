import { readFileSync, readdirSync } from "node:fs";
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
  it("the database's type -> kind list is exactly this list (the latest migration that writes notice_kind_of, and lib/coach-notice-kinds.ts never drift)", () => {
    // 0423 wrote the list; a later migration that adds a type writes the whole list again (0459: weekly_checkin). The newest one is the live list.
    const latest = readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql") && read(`supabase/migrations/${f}`).includes("create or replace function public.notice_kind_of("))
      .sort()
      .pop()!;
    expect(latest >= "0423").toBe(true);
    const sql = read(`supabase/migrations/${latest}`);
    // A later migration may instead add its line to the LIVE function in place (0463: exercise_swap), written inside a quoted string with its quotes doubled.
    const added = readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql") && f > latest && read(`supabase/migrations/${f}`).includes("pg_get_functiondef('public.notice_kind_of(text)'"))
      .flatMap((f) => {
        const s = read(`supabase/migrations/${f}`);
        const newLine = /v_new constant text := E'([^;]*)';/.exec(s.slice(s.indexOf("pg_get_functiondef('public.notice_kind_of(text)'")))?.[1] ?? "";
        return [...newLine.matchAll(/when ''([a-z_]+)'' then ''([a-z_]+)''/g)].map((m) => `${m[1]}:${m[2]}`);
      });
    const inSql = [...new Set([...[...sql.matchAll(/when '([a-z_]+)' then '([a-z_]+)'/g)].map((m) => `${m[1]}:${m[2]}`), ...added])].sort();
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
    // (the body sent is `text`: the sender's own, or a finished workout's words in the recipient's unit, wave 2)
    expect(route.indexOf("coachNoticeIsOff(db, profileId, kind)")).toBeLessThan(route.indexOf("sendPushToProfile(db, profileId, title, text, url)"));
    expect(route.indexOf("sendPushToProfile(db, profileId, title, text, url)")).toBeGreaterThan(-1);
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
    // inside the one closed Notifications row (Oct 21): only a coach on their own settings, and only once the column can be read
    expect(read("app/(coach)/groups/[groupId]/settings/page.tsx")).toContain("notices={isCoach && !viewingOther && noticesOff !== null ? { initialOff: noticesOff } : null}");
    expect(read("components/shared/notification-settings.tsx")).toContain("{notices && <NoticeSwitches");
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
  // The trigger may drop the row (a kind the coach switched off), so an insert that reads its id back may get none. Reading it back is allowed ONLY as .maybeSingle() whose id is used
  // through pushHrefForNotice (no id: the push falls back to the notice's own link); .single() (an error on no row) or using the id any other way is not.
  // Each insert call is read with its brackets matched, so a ")" inside it (new Date().toISOString()) does not end it early.
  function insertsWithTail(src: string): { call: string; tail: string }[] {
    const out: { call: string; tail: string }[] = [];
    const re = /from\("notifications"\)\s*\.insert\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      let depth = 1;
      let i = m.index + m[0].length;
      for (; i < src.length && depth > 0; i++) {
        if (src[i] === "(") depth++;
        else if (src[i] === ")") depth--;
      }
      out.push({ call: src.slice(m.index, i), tail: src.slice(i, i + 400) });
    }
    return out;
  }
  it("reading back the id of a notice row it inserted is only ever optional (the trigger may drop the row)", () => {
    for (const f of ["lib/notify-payment.ts", "lib/payment-events.ts", "app/api/session-pattern-check/route.ts", "app/api/cron/milestone-scan/route.ts"]) {
      const s = read(f);
      const inserts = insertsWithTail(s);
      expect(inserts.length, f).toBeGreaterThan(0);
      for (const { tail } of inserts) {
        if (!/^\s*\.select\(/.test(tail)) continue;
        expect(tail, `${f}: a read-back must be .maybeSingle()`).toMatch(/^\s*\.select\("id"\)\s*\.maybeSingle\(\)/);
        expect(s, `${f}: the id goes only through pushHrefForNotice (falls back to the link)`).toContain("pushHrefForNotice((notice as { id?: string } | null)?.id, ");
      }
    }
  });
  it("the guard sees a read-back past a ) inside the insert (the old one stopped at it)", () => {
    const [ins] = insertsWithTail('db.from("notifications").insert({ at: new Date().toISOString() }).select("id").single();');
    expect(ins.tail.startsWith('.select("id").single()')).toBe(true);
    expect(/^\s*\.select\("id"\)\s*\.maybeSingle\(\)/.test(ins.tail)).toBe(false);
  });
});
