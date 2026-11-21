import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { noticeHref, NOTICE_RESOLVE_PREFIX } from "@/lib/notice-links";
import { FILTER_OF_TYPE, filterOfType, NOTICE_FILTERS } from "@/lib/notice-filters";

// Every notice opens something real (Ron, Nov 19: a session-request notice "leads me to nothing"). Walks EVERY type the database allows, with the links its writers give it (as written, so old
// rows are covered too), and checks where noticeHref sends each: a page or route that exists, the Requests page for the four things a coach answers, never a coach-only page for a client, and
// never the bare Home or app root unless it is listed below with why it is right.
const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8").replace(/\r\n/g, "\n");

// The types the live database allows: notifications_type_check as the live database had it on Nov 19 (46). The migrations rebuild that check from the live one (0419, 0422), so it cannot be read
// from them; a migration that adds a type adds it here too (the test below fails on a type written in code that is not here).
const LIVE_TYPES = ["booking_request", "client_request", "client_request_answer", "coach_account_closed", "coach_departure_reminder", "comment", "content_reported", "credits_expired", "direct_message", "email_change_cancelled", "email_change_requested", "email_changed", "goal_answered", "goal_proposed", "gym_visitor_lead", "late_change", "macros_assigned", "meal_plan_try", "milestone_celebration", "minor_consent_needed", "new_training_block", "nutrition_allergies_updated", "nutrition_baseline_ready", "nutrition_preferences_changed", "nutrition_prompt_answered", "nutrition_target_changed", "org_announcement", "organization_invite", "partner_request", "partner_request_accepted", "payment_problem", "payment_received", "pr_promotion", "program_assigned", "recurring_booking_conflict", "request_decision", "schedule_applied", "schedule_request", "schedule_resumed", "session_pattern_note", "space_invite", "support_reply", "team_sheet_saved", "trainer_dispatch_offer", "trainer_dispatch_question", "waitlist_slot_offered",
  // step 215 (migration 0459, Nov 20): a client sent their weekly check-in
  "weekly_checkin",
  // step 219 (migration 0463, Nov 20): a client changed an exercise for every week of their own program
  "exercise_swap"];
function allowedTypes(): string[] {
  return LIVE_TYPES;
}

// Every type written by code (app/ and lib/) is one of them.
function typesWrittenInCode(): string[] {
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name !== "node_modules") walk(full);
      } else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) {
        const src = readFileSync(full, "utf8");
        if (!src.includes('from("notifications")')) continue;
        // an insert's own fields (a type: "..." within the call), or a helper's call naming its type
        for (const m of src.matchAll(/from\("notifications"\)\s*\.insert\(([\s\S]{0,600}?)\)\s*[;.]/g)) for (const t of m[1].matchAll(/type: "([a-z_]+)"/g)) found.add(t[1]);
      }
    }
  };
  walk(join(ROOT, "app"));
  walk(join(ROOT, "lib"));
  return [...found];
}

// Every page (page.tsx) and GET route (route.ts) of the app, as patterns.
function appRoutes(): RegExp[] {
  const out: RegExp[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === "page.tsx" || name === "route.ts") {
        const rel = relative(join(ROOT, "app"), dir).split(sep).filter((s) => s && !/^\(.*\)$/.test(s));
        const pattern = rel.map((s) => (/^\[\.\.\..+\]$/.test(s) ? ".+" : /^\[.+\]$/.test(s) ? "[^/]+" : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("/");
        out.push(new RegExp(`^/${pattern}$`));
      }
    }
  };
  walk(join(ROOT, "app"));
  return out;
}
const ROUTES = appRoutes();
const exists = (href: string) => {
  const path = href.split(/[?#]/)[0].replace(/\/$/, "") || "/";
  return path === "/" || ROUTES.some((r) => r.test(path));
};

const G = "/groups/11111111-1111-1111-1111-111111111111";
const A = "22222222-2222-2222-2222-222222222222";
type Case = { link: string | null; to: "coach" | "client" | "anyone"; group?: string | null; ok?: string };
// The links each type is written with (lib, app/api and the latest SQL writer of each; the "ok" ones go to a general page on purpose, with why).
const WRITTEN: Record<string, Case[]> = {
  booking_request: [{ link: "/dashboard", to: "coach" }],
  client_request: [{ link: "/clients/requests", to: "coach" }],
  client_request_answer: [
    { link: "/", to: "client", group: G.slice(8) },
    { link: "/", to: "client", ok: "declined: the person has no space with this coach, so the app's own start" },
  ],
  coach_account_closed: [{ link: "/api/account/export", to: "client", ok: "the download of their own data" }],
  coach_departure_reminder: [
    { link: "/dashboard", to: "coach", ok: "Home carries the leaving-coach banner with the steps" },
    { link: "/api/coach/exit-export?organizationId=x", to: "coach", ok: "the download of their clients' data" },
  ],
  comment: [
    { link: `${G}/feed`, to: "anyone" },
    { link: "/sessions/33333333-3333-3333-3333-333333333333", to: "anyone" },
  ],
  content_reported: [
    { link: `${G}/feed?highlight=p1`, to: "coach" },
    { link: "/reports", to: "coach" },
  ],
  credits_expired: [{ link: `${G}/calendar`, to: "client" }],
  direct_message: [{ link: `${G}/messages/${A}`, to: "anyone" }],
  email_change_cancelled: [
    { link: G, to: "client" },
    { link: "/", to: "client", ok: "nothing to open: the email stayed the same" },
  ],
  email_change_requested: [{ link: G, to: "client" }],
  email_changed: [
    { link: G, to: "client" },
    { link: "/", to: "client", ok: "nothing to open: a note that the email changed" },
  ],
  goal_answered: [
    { link: `${G}/athletes/${A}`, to: "coach" },
    { link: `${G}/goal`, to: "client" },
  ],
  goal_proposed: [{ link: `${G}/goal`, to: "client" }],
  gym_visitor_lead: [{ link: "/dashboard", to: "coach" }],
  late_change: [{ link: "/dashboard", to: "coach" }],
  macros_assigned: [{ link: G, to: "client" }],
  meal_plan_try: [{ link: `${G}/nutrition?athleteId=${A}`, to: "coach" }],
  milestone_celebration: [{ link: `${G}/athletes/${A}`, to: "coach" }],
  minor_consent_needed: [{ link: `${G}/athletes/${A}`, to: "coach" }],
  new_training_block: [{ link: G, to: "client" }],
  nutrition_allergies_updated: [{ link: `${G}/nutrition`, to: "client" }],
  nutrition_baseline_ready: [
    { link: `${G}/nutrition?athleteId=${A}`, to: "coach" },
    { link: `${G}/nutrition`, to: "coach" },
  ],
  nutrition_preferences_changed: [{ link: `${G}/nutrition?athleteId=${A}`, to: "coach" }],
  nutrition_prompt_answered: [{ link: `${G}/nutrition?athleteId=${A}`, to: "coach" }],
  nutrition_target_changed: [{ link: `${G}/nutrition`, to: "client" }],
  org_announcement: [{ link: "/dashboard", to: "anyone" }],
  organization_invite: [{ link: "/org-invite/i1", to: "coach" }],
  partner_request: [{ link: "/partners/requests", to: "client" }],
  partner_request_accepted: [{ link: "/partners/requests", to: "client" }],
  payment_problem: [
    { link: `${G}/business`, to: "coach" },
    { link: "/dashboard", to: "coach", ok: "a payment with no group: Home's business summary" },
  ],
  payment_received: [{ link: `${G}/business`, to: "coach" }],
  pr_promotion: [{ link: "/pr-promotion/p1", to: "client" }],
  program_assigned: [{ link: `${G}/programs/p1`, to: "client" }],
  recurring_booking_conflict: [
    { link: `${G}/calendar/2026-11-19#booking-b1`, to: "coach" },
    { link: "/recurring-conflicts", to: "coach" },
  ],
  request_decision: [{ link: `${G}/calendar`, to: "client" }],
  schedule_applied: [
    { link: "/dashboard", to: "coach" },
    { link: `${G}/my-schedule`, to: "client" },
    { link: "/", to: "client", ok: "written when the client was removed: they have no space with this coach any more" },
  ],
  schedule_request: [{ link: "/dashboard", to: "coach" }],
  schedule_resumed: [
    { link: `${G}/athletes/${A}`, to: "coach" },
    { link: `${G}/my-schedule`, to: "client" },
  ],
  session_pattern_note: [{ link: "/sessions/s1/coach-note", to: "coach" }],
  space_invite: [{ link: "/space-invite/i1", to: "client" }],
  support_reply: [
    { link: "/admin/support", to: "coach" },
    { link: `${G}/business/support`, to: "coach" },
    { link: "/dashboard", to: "coach", ok: "a support thread with no group: Home, where Support is" },
  ],
  team_sheet_saved: [{ link: `${G}/team-sheet`, to: "coach" }],
  trainer_dispatch_offer: [
    { link: "/dispatch/d1", to: "coach" },
    { link: "/dashboard", to: "coach", ok: "to the organization's admins when no trainer took it: Home's dispatch notice" },
  ],
  trainer_dispatch_question: [
    { link: "/dispatch/d1", to: "coach" },
    { link: "/dashboard", to: "coach", ok: "to the organization's admins: Home's dispatch notice" },
  ],
  waitlist_slot_offered: [{ link: `${G}/calendar/2026-11-19`, to: "client" }],
  weekly_checkin: [{ link: "/clients/check-ins", to: "coach" }],
  exercise_swap: [{ link: `${G}/programs/p1?swap=s1`, to: "coach" }],
};

// Pages only a coach can open (a client sent there gets "only coaches...").
const COACH_ONLY = [/^\/dashboard/, /^\/requests/, /^\/recurring-conflicts/, /^\/groups\/[^/]+\/athletes\//, /^\/groups\/[^/]+\/business/, /^\/clients/];

describe("every notice type opens something real", () => {
  const types = allowedTypes();
  it("the database's own list of types (46 on Nov 19, 47 with step 215, 48 with step 219), and every type code writes is on it", () => {
    expect(types.length).toBe(48);
    const written = typesWrittenInCode();
    expect(written.length).toBeGreaterThan(5);
    for (const t of written) expect(types, t).toContain(t);
  });
  it("every type has its written links here, and nothing here is not a type", () => {
    expect(Object.keys(WRITTEN).sort()).toEqual([...types].sort());
  });
  for (const type of Object.keys(WRITTEN)) {
    it(`${type}`, () => {
      for (const c of WRITTEN[type]) {
        const href = noticeHref(type, c.link, { id: "44444444-4444-4444-4444-444444444444", groupId: c.group ?? null });
        expect(exists(href), `${type} ${c.link} -> ${href} is no page`).toBe(true);
        if (c.to === "client" || c.to === "anyone") expect(COACH_ONLY.some((r) => r.test(href)), `${type} sends a client to ${href}`).toBe(false);
        if ((href === "/dashboard" || href === "/") && !c.ok) throw new Error(`${type} ${c.link} opens ${href}, which is not the item`);
      }
    });
  }
  it("the four things a coach answers open the Requests page at the request, whatever the database wrote", () => {
    for (const type of ["booking_request", "late_change", "schedule_request", "client_request"]) {
      for (const link of ["/dashboard", "/dashboard#late-changes", "/clients/requests", null]) expect(noticeHref(type, link, { id: "n1" })).toBe("/requests?notice=n1");
    }
    // a link that already names its page keeps it
    expect(noticeHref("booking_request", `${G}/calendar`, { id: "n1" })).toBe(`${G}/calendar`);
  });
  it("a client's answer to a session request opens that session's day, found from the notice", () => {
    expect(noticeHref("request_decision", `${G}/calendar`, { id: "n1" })).toBe(`${NOTICE_RESOLVE_PREFIX}n1`);
    const route = read("app/notice/[id]/route.ts");
    expect(route).toContain('.eq("athlete_id", user.id)');
    expect(route).toContain('.eq("profile_id", user.id)');
    expect(route).toContain("return go(`/groups/${notice.group_id}/calendar/${dateKeyInZone(tz, new Date(day))}`);");
    expect(route).toContain("if (active?.anchor) return go(`/groups/${active.anchor.id}/business/leads`);");
  });
  it("the old client-requests page sends people to the Requests page", () => {
    expect(read("app/(coach)/clients/requests/page.tsx")).toContain("redirect(REQUESTS_PATH);");
  });
});

describe("every notice type is under one filter chip", () => {
  it("each type the database allows has a chip, and Other catches anything new", () => {
    for (const t of allowedTypes()) expect(Object.keys(FILTER_OF_TYPE), t).toContain(t);
    expect(filterOfType("something_new")).toBe("other");
    expect(NOTICE_FILTERS.map((f) => f.label)).toEqual(["Requests", "Messages", "Clients", "Programs", "Business", "Other"]);
  });
  it("the four things a coach answers are Requests", () => {
    for (const t of ["booking_request", "late_change", "schedule_request", "client_request"]) expect(filterOfType(t)).toBe("requests");
  });
});
