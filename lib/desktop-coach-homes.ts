import { hiddenForCoach, type CoachNavFacts } from "@/lib/team-coach";
import { CLIENTS_HREF, membersHref, showsMembers, type GroupKindLite } from "@/lib/coach-clients-nav";
import { ALL_PROGRAMS_HREF } from "@/lib/programs-scope";
import { TEAM_SPORT_BUSINESS_LABEL, teamSportBusinessHref } from "@/lib/team-sport";

// FIX 6, six homes on the COMPUTER (Ron approved "all six need to be done"; docs/build-orders-oct19/FIX6_SIX_HOMES_DESKTOP.md). The rail is six icons; each home has a strip of tabs at the top of the
// page, chosen by the address. Every page keeps its file and its address and no redirect is added: this file only says which home and which tab an address belongs to, and which tabs each
// home shows for this coach in this group (the hiding rules moved word for word from the old menus). Pure, so the route table is tested against every page on disk. The phone is not touched.

export type HomeKey = "home" | "clients" | "calendar" | "programs" | "messages" | "settings";

export const HOMES: { key: HomeKey; label: string }[] = [
  { key: "home", label: "Home" },
  { key: "clients", label: "Clients" },
  { key: "calendar", label: "Calendar" },
  { key: "programs", label: "Programs" },
  { key: "messages", label: "Messages" },
  { key: "settings", label: "Settings" },
];

export interface HomeTab {
  key: string;
  label: string;
  href: string;
  newTab?: boolean;
  // Which live count the shell puts on this tab.
  badge?: "clients" | "messages" | "feed" | "support";
  // A label the coach can reword ("Clients" -> "Athletes").
  termKey?: "client" | "program";
}

export interface HomeFacts {
  groupId: string;
  coachLevel: boolean;
  groupKind: GroupKindLite;
  teamMode: boolean;
  // A team-sport group, on a page that belongs to a group (never a coach-level page): lib/team-sport.ts.
  teamSport: boolean;
  // lib/team-sport.ts moneyHiddenFor.
  moneyHidden: boolean;
  navFacts: CoachNavFacts | null;
  isPlatformAdmin: boolean;
  onFrontDesk: boolean;
}

// Tabs that sell to clients: not shown where the money numbers are hidden (a team-only organization, a team-sport group).
const MONEY_TABS = new Set(["business", "leads", "waiver", "session-ledger", "packages", "availability", "booking-page", "session-types", "resources", "website", "zapier"]);

export function homeTabs(f: HomeFacts): Record<HomeKey, HomeTab[]> {
  const g = `/groups/${f.groupId}`;
  const inGroup = f.groupKind !== null && f.groupKind !== undefined && f.groupKind !== "one_on_one";
  const tabs: Record<HomeKey, (HomeTab | false)[]> = {
    home: [
      { key: "today", label: "Today", href: "/dashboard" },
      { key: "business", label: "Business", href: `${g}/business` },
      !f.teamSport && { key: "group-dashboard", label: "Group dashboard", href: `${g}/dashboard` },
    ],
    clients: [
      f.teamSport
        ? { key: "members", label: "Athletes", href: membersHref(f.groupId), badge: "clients", termKey: "client" }
        : { key: "clients", label: "Clients", href: CLIENTS_HREF, badge: "clients", termKey: "client" },
      !f.teamSport && showsMembers(f.groupKind, f.coachLevel) && { key: "members", label: "Members", href: membersHref(f.groupId) },
      { key: "leads", label: "Leads", href: `${g}/business/leads` },
      inGroup && { key: "attendance", label: "Attendance", href: `${g}/attendance` },
      f.onFrontDesk && { key: "front-desk", label: "Front desk", href: "/front-desk", newTab: true },
      { key: "waiver", label: "Waiver", href: `${g}/business/waiver` },
      { key: "session-ledger", label: "Session ledger", href: `${g}/business/session-ledger` },
      { key: "packages", label: "Packages", href: `${g}/business/packages` },
    ],
    calendar: [
      // a team-sport group's calendar is the team calendar (its address lights that tab)
      f.teamSport ? { key: "team-calendar", label: "Team calendar", href: `${g}/team/calendar` } : { key: "schedule", label: "Schedule", href: "/calendar" },
      { key: "availability", label: "Availability", href: "/calendar?tab=availability" },
      !f.teamSport && { key: "group-calendar", label: "Group calendar", href: f.coachLevel ? "/group-calendar" : `${g}/group-calendar` },
      !f.teamSport && f.teamMode && { key: "team-calendar", label: "Team calendar", href: `${g}/team/calendar` },
      !f.teamSport && { key: "group-sessions", label: "Group sessions", href: `${g}/group-sessions` },
      { key: "booking-page", label: "Booking page", href: `${g}/business/booking-page` },
      { key: "session-types", label: "Session types", href: `${g}/business/session-types` },
      !f.teamSport && { key: "kiosk", label: "Kiosk check-in", href: `${g}/kiosk/settings` },
    ],
    programs: [
      { key: "programs", label: "Programs", href: ALL_PROGRAMS_HREF, termKey: "program" },
      { key: "exercise-library", label: "Exercise library", href: `${g}/exercise-library` },
      { key: "nutrition", label: "Nutrition", href: `${g}/nutrition` },
      { key: "challenges", label: "Challenges", href: `${g}/challenges` },
      { key: "records", label: "Hall of fame", href: `${g}/records` },
      f.teamMode ? { key: "team", label: "Depth chart", href: `${g}/team` } : f.groupKind === "team" && { key: "team", label: "Seasons", href: `${g}/team` },
      { key: "team-performance", label: "Team performance", href: `${g}/team-performance` },
      f.teamSport && { key: "team-sheet", label: "Team sheet", href: `${g}/team-sheet` },
    ],
    messages: [
      { key: "messages", label: "Messages", href: `${g}/messages`, badge: "messages" },
      inGroup && { key: "feed", label: "Team feed", href: `${g}/feed`, badge: "feed" },
      f.isPlatformAdmin && { key: "admin-support", label: "Support inbox", href: "/admin/support", badge: "support" },
    ],
    settings: [
      { key: "settings", label: "Account", href: `${g}/settings` },
      { key: "display", label: "Display mode", href: `${g}/display`, newTab: true },
      { key: "sms-settings", label: "Text messages", href: `${g}/business/sms-settings` },
      { key: "support", label: "Support", href: `${g}/business/support` },
      { key: "quick-tips", label: "Quick tips", href: `${g}/quick-tips` },
      { key: "branding", label: "Organization", href: `${g}/branding` },
      { key: "resources", label: "Pro shop and referrals", href: `${g}/resources` },
      { key: "website", label: "My website", href: `${g}/business/website` },
      { key: "zapier", label: "Zapier", href: `${g}/business/zapier` },
      f.teamSport && { key: "business-tools", label: TEAM_SPORT_BUSINESS_LABEL, href: teamSportBusinessHref(f.groupId) },
      f.isPlatformAdmin && { key: "admin-organizations", label: "Organizations", href: "/admin/organizations" },
      f.isPlatformAdmin && { key: "admin-ranking", label: "Marketplace ranking", href: "/admin/marketplace-ranking" },
    ],
  };
  const out = {} as Record<HomeKey, HomeTab[]>;
  for (const h of HOMES) {
    out[h.key] = (tabs[h.key].filter(Boolean) as HomeTab[]).filter((t) => !(f.moneyHidden && MONEY_TABS.has(t.key)) && !hiddenForCoach(f.navFacts, t.key));
  }
  return out;
}

// ---- which home and tab an address belongs to ----

const ID = "[^/]+";
type Rule = { re: RegExp; home: HomeKey; tab: string | null; when?: (q: URLSearchParams) => boolean };
const G = `/groups/${ID}`;
const rule = (path: string, home: HomeKey, tab: string | null, when?: Rule["when"]): Rule => ({ re: new RegExp(`^${path}$`), home, tab, when });

// First match wins (a rule with `when` is tried before the same path without it).
const RULES: Rule[] = [
  // Home
  rule("/dashboard", "home", "today"),
  rule("/notifications", "home", null),
  rule(`${G}/business`, "home", "business"),
  rule(`${G}/dashboard`, "home", "group-dashboard"),
  // Clients
  rule("/clients", "clients", "clients"),
  rule("/clients/requests", "clients", "clients"),
  rule("/running-low", "clients", "clients"),
  rule(`${G}/clients`, "clients", "members", (q) => q.get("view") === "members"),
  rule(`${G}/clients`, "clients", "clients"),
  rule(`${G}/athletes/${ID}`, "clients", "clients"),
  rule(`${G}/athletes/${ID}/calendar`, "clients", "clients"),
  rule(`${G}/athletes/${ID}/calendar/${ID}`, "clients", "clients"),
  rule(`${G}/athletes/${ID}/history`, "clients", "clients"),
  rule(`${G}/athletes/${ID}/view`, "clients", "clients"),
  rule(`${G}/business/leads`, "clients", "leads"),
  rule(`${G}/attendance`, "clients", "attendance"),
  rule("/front-desk", "clients", "front-desk"),
  rule(`${G}/business/waiver`, "clients", "waiver"),
  rule(`${G}/business/session-ledger`, "clients", "session-ledger"),
  rule(`${G}/business/packages`, "clients", "packages"),
  // Calendar
  rule("/calendar", "calendar", "availability", (q) => q.get("tab") === "availability"),
  rule("/calendar", "calendar", "schedule"),
  rule(`${G}/calendar`, "calendar", "schedule"),
  rule(`${G}/calendar/${ID}`, "calendar", "schedule"),
  rule("/recurring-conflicts", "calendar", "schedule"),
  rule(`${G}/availability`, "calendar", "availability"),
  rule("/group-calendar", "calendar", "group-calendar"),
  rule(`${G}/group-calendar`, "calendar", "group-calendar"),
  rule(`${G}/team/calendar`, "calendar", "team-calendar"),
  rule(`${G}/team/calendar/games/${ID}`, "calendar", "team-calendar"),
  rule(`${G}/group-sessions`, "calendar", "group-sessions"),
  rule(`${G}/business/booking-page`, "calendar", "booking-page"),
  rule(`${G}/business/session-types`, "calendar", "session-types"),
  rule(`${G}/kiosk/settings`, "calendar", "kiosk"),
  // Programs
  rule("/programs", "programs", "programs"),
  rule(`${G}/programs`, "programs", "programs"),
  rule(`${G}/programs/new`, "programs", "programs"),
  rule(`${G}/programs/import`, "programs", "programs"),
  rule(`${G}/programs/${ID}`, "programs", "programs"),
  rule(`${G}/programs/${ID}/progressions`, "programs", "programs"),
  rule(`${G}/workouts/${ID}/clients`, "programs", "programs"),
  rule(`${G}/exercise-library`, "programs", "exercise-library"),
  rule(`${G}/games/${ID}`, "programs", "exercise-library"),
  rule(`${G}/tools/one-rep-max`, "programs", "exercise-library"),
  rule(`${G}/movement-patterns`, "programs", "exercise-library"),
  rule(`${G}/nutrition`, "programs", "nutrition"),
  rule(`${G}/nutrition/nutrients/${ID}`, "programs", "nutrition"),
  rule(`${G}/recipes`, "programs", "nutrition"),
  rule(`${G}/tools/macro-calculator`, "programs", "nutrition"),
  rule(`${G}/challenges`, "programs", "challenges"),
  rule(`${G}/challenges/${ID}`, "programs", "challenges"),
  rule(`${G}/records`, "programs", "records"),
  rule(`${G}/team`, "programs", "team"),
  rule(`${G}/team-performance`, "programs", "team-performance"),
  rule(`${G}/team-sheet`, "programs", "team-sheet"),
  rule(`${G}/team-sheet/upload`, "programs", "team-sheet"),
  // Messages
  rule(`${G}/messages`, "messages", "messages"),
  rule(`${G}/messages/announce`, "messages", "messages"),
  rule(`${G}/messages/${ID}`, "messages", "messages"),
  rule(`${G}/feed`, "messages", "feed"),
  rule(`${G}/leaderboard`, "messages", "feed"),
  rule("/admin/support", "messages", "admin-support"),
  rule("/reports", "messages", null),
  // Settings
  rule(`${G}/settings`, "settings", "settings"),
  rule(`${G}/display`, "settings", "display"),
  rule(`${G}/business/sms-settings`, "settings", "sms-settings"),
  rule(`${G}/business/support`, "settings", "support"),
  rule(`${G}/quick-tips`, "settings", "quick-tips"),
  rule(`${G}/branding`, "settings", "branding"),
  rule(`${G}/revenue-splits`, "settings", "branding"),
  rule(`${G}/team-activity`, "settings", "branding"),
  rule(`${G}/coaches/${ID}`, "settings", "branding"),
  rule(`${G}/resources`, "settings", "resources"),
  rule(`${G}/pro-shop`, "settings", "resources"),
  rule(`${G}/referrals`, "settings", "resources"),
  rule(`${G}/business/website`, "settings", "website"),
  rule(`${G}/business/zapier`, "settings", "zapier"),
  rule("/admin/organizations", "settings", "admin-organizations"),
  rule("/admin/marketplace-ranking", "settings", "admin-ranking"),
  rule(`/admin/${ID}`, "settings", null),
];

/** Pages that are not part of any home on the computer: a client's own pages, in-person logging, tablet screens. Patterns over the route (with [params]). */
export const DESKTOP_EXCLUDED: string[] = [
  "/groups/[groupId]",
  "/groups/[groupId]/about-you",
  "/groups/[groupId]/goal",
  "/groups/[groupId]/more",
  "/groups/[groupId]/my-history",
  "/groups/[groupId]/my-schedule",
  "/groups/[groupId]/classes",
  "/groups/[groupId]/today",
  "/groups/[groupId]/workouts/[workoutId]",
  "/groups/[groupId]/progress-photos",
  "/groups/[groupId]/video-checkins",
  "/groups/[groupId]/transformation/new",
  "/groups/[groupId]/billing/canceled",
  "/groups/[groupId]/billing/success",
  "/groups/[groupId]/programs/[programId]/calendar",
  "/groups/[groupId]/programs/[programId]/calendar/[date]",
  "/groups/[groupId]/athletes/[athleteId]/log",
  "/groups/[groupId]/athletes/[athleteId]/log/[workoutId]",
  "/groups/[groupId]/kiosk",
];

export function homeOfPath(pathname: string, search = ""): { home: HomeKey; tab: string | null } | null {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const path = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  for (const r of RULES) {
    if (r.re.test(path) && (!r.when || r.when(q))) return { home: r.home, tab: r.tab };
  }
  return null;
}

/** Where a home's rail icon goes: its first tab this coach can see. */
export function homeHref(tabs: Record<HomeKey, HomeTab[]>, home: HomeKey): string | null {
  return tabs[home][0]?.href ?? null;
}
