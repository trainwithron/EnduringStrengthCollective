import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// The bug Ron found on the Business page: a count that asks for "this coach's rows" (coach_id = me) on a table whose rows belong to a group counts EVERY organization the coach is in, so an
// organization with no clients showed another organization's totals. Any read of such a table that filters by coach_id alone, with no group scope within the same query, fails here until it
// is scoped (orgGroupIdsOf / .in("group_id", ...)) or added below with the reason it is safe.
const ROOT = join(__dirname, "..");
const ORG_TIED_TABLES = [
  "booking_requests", "booking_waitlist_entries", "bookings", "coach_packages", "coach_quick_payments", "group_sessions", "recurring_booking_series", "revenue_split_transfers",
  "schedule_requests", "session_pattern_checks", "support_requests", "challenges", "referral_partners", "pro_shop_links",
];
const REVIEWED = new Set([
  // services that run for every coach with no screen (cron, webhook, public booking page), where "this coach's rows" is the right unit
  "app/api/cron/series-top-up/route.ts", "app/api/discovery-availability/[coachId]/route.ts", "app/api/stripe/webhook/route.ts", "lib/series-store.ts", "app/admin/support/page.tsx",
  // the coach's own gaps and hours across everything they teach (times only, no client names), and an organization-wide load figure keyed by organization
  "lib/calendar-spotter-phase2-gather.ts",
  // one client's own waitlist entries with this coach (the athlete is named in the query)
  "app/(coach)/groups/[groupId]/calendar/[date]/page.tsx", "app/(coach)/groups/[groupId]/programs/[programId]/calendar/[date]/page.tsx", "components/athlete/waitlist-join-button.tsx",
  // coach-level shop links and referral partners: the table has no group or organization column, they are the coach's own business, not an organization's data (Ron to decide if shops become per organization)
  "app/(coach)/groups/[groupId]/resources/page.tsx", "components/coach/desktop/pro-shop-manager.tsx", "components/shared/coach-profile-popup.tsx",
  "app/(coach)/groups/[groupId]/athletes/[athleteId]/calendar/[date]/page.tsx", "app/(coach)/groups/[groupId]/business/page.tsx",
  // challenges have no group or organization column (only an optional program): listed as an open item for Ron
  "app/(coach)/groups/[groupId]/challenges/page.tsx", "app/(coach)/groups/[groupId]/revenue-splits/page.tsx", "components/coach/desktop/challenge-creator.tsx",
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

describe("no count or list is every organization's rows for a coach in several", () => {
  const offenders: string[] = [];
  for (const dir of ["app", "components", "lib"]) {
    for (const file of walk(join(ROOT, dir))) {
      const rel = relative(ROOT, file).replace(/\\/g, "/");
      if (REVIEWED.has(rel)) continue;
      const lines = readFileSync(file, "utf8").replace(/\r\n/g, "\n").split("\n");
      lines.forEach((line, i) => {
        const m = line.match(/\.from\("([a-z_]+)"\)/);
        if (!m || !ORG_TIED_TABLES.includes(m[1])) return;
        const window = lines.slice(i, i + 12).join(" ");
        if (!/coach_id/.test(window)) return;
        if (/group_id|orgGroupIds|groupIds|\.eq\("id"|\.in\("id"|booking_id|\.single\(\)/.test(window)) return;
        offenders.push(`${rel}:${i + 1} ${m[1]}`);
      });
    }
  }
  it("every read of an organization's table by coach_id alone is scoped to the open organization or reviewed", () => {
    expect(offenders).toEqual([]);
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
