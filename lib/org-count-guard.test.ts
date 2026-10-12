import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// The bug Ron found on the Business page: a count that asks for "this coach's rows" (coach_id = me) on a table whose rows belong to a group counts EVERY organization the coach is in, so an
// organization with no clients showed another organization's totals. Any read of such a table that filters by coach_id alone, with no group filter inside the same query, fails here until it is
// scoped (orgGroupIdsOf / .in("group_id", ...) / .eq("group_id", ...)) or listed below as file::table with the reason it is safe.
const ROOT = join(__dirname, "..");
const ORG_TIED_TABLES = [
  "booking_requests", "booking_waitlist_entries", "bookings", "coach_packages", "coach_quick_payments", "group_sessions", "recurring_booking_series", "revenue_split_transfers",
  "schedule_requests", "session_pattern_checks", "support_requests", "challenges", "referral_partners", "pro_shop_links", "coach_briefings", "coach_view_state", "pro_shop_link_day_pins",
  "discovery_bookings",
];
// Each entry is file::table. Every one is a read that is correct as it is.
const REVIEWED = new Set([
  // services that run for every coach with no screen (cron, webhook, public booking page), where "this coach's rows" is the right unit
  "app/api/cron/series-top-up/route.ts::bookings",
  "app/api/discovery-availability/[coachId]/route.ts::bookings",
  "app/api/stripe/webhook/route.ts::revenue_split_transfers",
  "lib/series-store.ts::bookings",
  "app/admin/support/page.tsx::support_requests",
  // the coach's own busy times across everything they teach (times only, no client names), and an organization-wide load figure keyed by organization
  "lib/calendar-spotter-phase2-gather.ts::bookings",
  // more services with no screen (cron jobs, the session-pattern writer, the quick-payment webhook, the briefing writer)
  "app/api/cron/coach-briefing/route.ts::coach_briefings",
  "app/api/cron/flag-recurring-booking-conflicts/route.ts::bookings",
  "app/api/cron/process-booking-waitlist/route.ts::booking_waitlist_entries",
  "app/api/cron/series-top-up/route.ts::recurring_booking_series",
  "app/api/cron/session-reminder/route.ts::bookings",
  "app/api/session-pattern-check/route.ts::session_pattern_checks",
  "app/api/stripe/webhook/route.ts::coach_quick_payments",
  "lib/series-store.ts::recurring_booking_series",
  // Home reads only the ids of today's briefings (one per organization since Release AY); the items are then limited to the open organization's groups on the same page
  "app/(coach)/dashboard/page.tsx::coach_briefings",
  // the late-changes panel is limited to the groups its caller passes (Home and the phone Home both pass the open organization's), applied on the next lines
  "components/coach/late-changes-panel.tsx::bookings",
  "components/coach/late-changes-panel.tsx::booking_requests",
  // view bookkeeping (ids and times of what a coach has seen in one group, written and read for the group being viewed)
  "components/coach/coach-desktop-shell.tsx::coach_view_state",
  "components/coach/desktop/mark-all-seen-button.tsx::coach_view_state",
  // discovery-call prospects have no organization column yet (planned with the per-organization migration)
  "app/api/discovery-availability/[coachId]/route.ts::discovery_bookings",
  "lib/series-store.ts::discovery_bookings",
  "lib/trainer-dispatch-advance.ts::discovery_bookings",
  // the public mini site shows the coach's packages and shop; becomes per organization with the Pro Shop work
  "app/c/[slug]/page.tsx::coach_packages",
  "app/c/[slug]/page.tsx::pro_shop_links",
  "components/shared/coach-profile-popup.tsx::pro_shop_links",
  // OPEN, waiting on the per-organization migration for coach-level tables (shop links, referral partners, challenges): they have no group or organization column yet
  "app/(coach)/groups/[groupId]/resources/page.tsx::referral_partners",
  "app/(coach)/groups/[groupId]/resources/page.tsx::pro_shop_links",
  "app/(coach)/groups/[groupId]/business/page.tsx::referral_partners",
  "app/(coach)/groups/[groupId]/business/page.tsx::pro_shop_links",
  "app/(coach)/groups/[groupId]/challenges/page.tsx::challenges",
  "app/(coach)/groups/[groupId]/revenue-splits/page.tsx::challenges",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".next", ".git"].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

// A read is limited when its own query (from .from("table") to the end of the statement) filters the group, the organization, or one row by id.
const LIMITED = /\.(in|eq)\("group_id"|organization_id|\.eq\("id"|\.in\("id"|\.in\("(?:booking_id|athlete_id)"|\.eq\("(?:booking_id|athlete_id)"|\.single\(\)/;

describe("no count or list is every organization's rows for a coach in several", () => {
  const offenders: string[] = [];
  const seenReviewed = new Set<string>();
  for (const dir of ["app", "components", "lib"]) {
    for (const file of walk(join(ROOT, dir))) {
      const rel = relative(ROOT, file).replace(/\\/g, "/");
      const lines = readFileSync(file, "utf8").replace(/\r\n/g, "\n").split("\n");
      lines.forEach((line, i) => {
        const m = line.match(/\.from\("([a-z_]+)"\)/);
        if (!m || !ORG_TIED_TABLES.includes(m[1])) return;
        // the statement: until a line that ends it (a semicolon) or 14 lines
        let end = i;
        while (end < lines.length - 1 && end - i < 14 && !/;\s*$/.test(lines[end])) end++;
        const statement = lines.slice(i, end + 1).join(" ");
        if (!/coach_id/.test(statement)) return;
        if (LIMITED.test(statement)) return;
        const key = `${rel}::${m[1]}`;
        if (REVIEWED.has(key)) seenReviewed.add(key);
        else offenders.push(`${rel}:${i + 1} ${m[1]}`);
      });
    }
  }
  it("every read of an organization's table by coach_id alone is scoped to the open organization or reviewed", () => {
    expect(offenders).toEqual([]);
  });
  it("the reviewed list holds no stale entry (one that is now scoped or gone should be removed)", () => {
    expect([...REVIEWED].filter((k) => !seenReviewed.has(k))).toEqual([]);
  });
});

describe("the Business page counts one organization", () => {
  const src = readFileSync(join(ROOT, "app/(coach)/groups/[groupId]/business/page.tsx"), "utf8").replace(/\r\n/g, "\n");
  it("sessions this month and the packages check are limited to the organization's groups", () => {
    expect(src).toMatch(/from\("bookings"\)[\s\S]{0,200}\.in\("group_id", groupIds/);
    expect(src).toMatch(/from\("coach_packages"\)[\s\S]{0,160}\.in\("group_id", safeGroupIds\)/);
  });
  it("says it is this organization, not every group you coach", () => {
    expect(src).toContain("A snapshot of this organization.");
    expect(src).not.toContain("every group you coach");
  });
});

describe("Home's time-to-progress cards read only the open organization", () => {
  it("the route gathers only the open organization's groups", () => {
    const route = readFileSync(join(ROOT, "app/api/progress-look/route.ts"), "utf8").replace(/\r\n/g, "\n");
    expect(route).toContain("getActiveAnchor(supabase, user.id)");
    expect(route).toContain("active.groups.filter((g) => g.orgId === active.orgId)");
  });
});
