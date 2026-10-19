// One real phone app for coaches (Ron, Oct 19: today's phone app is "the full desktop version with a cutesy view-desktop button"). On a phone a coach has a short, fixed list of places;
// any other coach page opened there (an old link, a bookmark, a notice) goes to the closest of those places instead of showing the computer page squeezed onto a phone. Plain functions,
// no Next imports, so the middleware, the pages and the tests all use the same rule.

/** Whether this request should get the phone app: the coach's own saved choice wins, else the installed app or a phone or tablet browser. The one rule (lib/pwa-server.ts uses it too). */
export function isPhoneView({ override, standalone, userAgent }: { override: string | null | undefined; standalone: string | null | undefined; userAgent: string | null | undefined }): boolean {
  if (override === "desktop") return false;
  if (override === "mobile") return true;
  return standalone === "1" || /android|iphone|ipad|ipod|mobile/i.test(userAgent ?? "");
}

export interface PhoneRedirect {
  /** Where the phone goes instead. */
  to: string;
  /** The group in the path, when there is one: the redirect applies only to a person who COACHES that group. */
  groupId: string | null;
  /** A page clients use too: not redirected while the coach is acting as a client. */
  shared: boolean;
}

const GROUP = /^\/groups\/([0-9a-f-]{36})(\/.*)?$/i;
const ID = "[^/]+";

// Pages under /groups/<g> and where they go on a phone. Targets keep the same <g>; "{a}" and "{p}" are the client and program from the path.
const GROUP_TABLE: { pattern: RegExp; to: string; shared?: boolean }[] = [
  ...["dashboard", "business", "business/packages", "business/leads", "business/website", "business/zapier", "business/waiver", "revenue-splits", `coaches/${ID}`, "team", "team-sheet", "team-sheet/upload", "team-performance"].map((p) => ({ pattern: new RegExp(`^/${p}$`), to: "" })),
  ...["business/booking-page", "business/session-types", "availability", "group-sessions", "group-calendar"].map((p) => ({ pattern: new RegExp(`^/${p}$`), to: "/calendar" })),
  { pattern: /^\/business\/session-ledger$/, to: "/clients" },
  ...["business/sms-settings", "business/support", "branding"].map((p) => ({ pattern: new RegExp(`^/${p}$`), to: "/settings" })),
  { pattern: /^\/messages\/announce$/, to: "/messages" },
  { pattern: /^\/team-activity$/, to: "/feed" },
  ...["challenges", `challenges/${ID}`, "records", `games/${ID}`].map((p) => ({ pattern: new RegExp(`^/${p}$`), to: "/feed", shared: true })),
  ...["resources", "quick-tips", "pro-shop", "referrals"].map((p) => ({ pattern: new RegExp(`^/${p}$`), to: "", shared: true })),
];

// Pages under /groups/<g> that go to the coach-level Programs page.
const TO_PROGRAMS: { pattern: RegExp; shared?: boolean }[] = [
  { pattern: /^\/exercise-library$/ },
  { pattern: /^\/movement-patterns$/ },
  { pattern: new RegExp(`^/workouts/${ID}/clients$`) },
  { pattern: /^\/programs\/import$/ },
  { pattern: /^\/tools\/one-rep-max$/, shared: true },
];

/**
 * Where a coach's phone goes instead of this page, or null when the page belongs on the phone (or is not a coach page at all).
 * The query is dropped unless a rule needs it.
 */
export function phoneCoachRedirect(pathname: string, search = ""): PhoneRedirect | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (pathname === "/calendar") return params.get("tab") === "availability" ? { to: "/calendar", groupId: null, shared: false } : null;
  if (pathname === "/group-calendar" || pathname === "/recurring-conflicts") return { to: "/calendar", groupId: null, shared: false };
  if (pathname === "/running-low") return { to: "/clients", groupId: null, shared: false };

  const m = GROUP.exec(pathname);
  if (!m) return null;
  const g = m[1];
  const rest = m[2] ?? "";
  const base = `/groups/${g}`;

  for (const r of GROUP_TABLE) if (r.pattern.test(rest)) return { to: base + r.to, groupId: g, shared: !!r.shared };
  for (const r of TO_PROGRAMS) if (r.pattern.test(rest)) return { to: "/programs", groupId: g, shared: !!r.shared };

  const progressions = new RegExp(`^/programs/(${ID})/progressions$`).exec(rest);
  if (progressions) return { to: `${base}/programs/${progressions[1]}`, groupId: g, shared: false };
  const athleteCalendar = new RegExp(`^/athletes/(${ID})/calendar(?:/${ID})?$`).exec(rest);
  if (athleteCalendar) return { to: `${base}/athletes/${athleteCalendar[1]}?tab=calendar`, groupId: g, shared: false };
  const athleteOther = new RegExp(`^/athletes/(${ID})/(?:history|view)$`).exec(rest);
  if (athleteOther) return { to: `${base}/athletes/${athleteOther[1]}`, groupId: g, shared: false };

  return null;
}
