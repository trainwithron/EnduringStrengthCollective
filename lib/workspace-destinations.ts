// The unified workspace (Ron, Oct 6-7: "I want to put anything next to anything"). A PANE shows one DESTINATION: any page of the app, or one client's page. There are no
// fixed presets: the coach picks a destination from a searchable list (Calendar, Business, a client's Messages...), and the last few are remembered. This file is the
// destination model and its search; it is pure, so it is testable without a screen.

export interface WorkspaceDestination {
  // Stable key: the same destination always has the same id (used for "recent", for not opening the same thing twice, and for saved layouts).
  id: string;
  label: string;
  // The page it shows, as an app path ("/groups/abc/calendar"). Never an outside address (see isAllowedWorkspacePath).
  path: string;
  // Small grouping line in the picker ("Business", "Maria Lopez").
  section: string;
  // Extra words that find it ("money" finds Business).
  keywords?: string[];
}

interface PageDef {
  key: string;
  label: string;
  section: string;
  // Path under the group ("calendar", "business/packages"); "" for none; or an absolute path that does not use the group.
  path: string;
  absolute?: boolean;
  keywords?: string[];
  // Only offered inside a team or social group.
  groupOnly?: boolean;
}

// Every page a coach can put in a pane. Kept in step with the nav in components/coach/coach-desktop-shell.tsx (a test checks no path here is wrong-looking).
const PAGES: PageDef[] = [
  { key: "home", label: "Home", section: "Run my day", path: "/dashboard", absolute: true, keywords: ["dashboard", "today"] },
  { key: "clients", label: "Clients", section: "Run my day", path: "/clients", absolute: true, keywords: ["people", "roster", "athletes"] },
  { key: "calendar", label: "Calendar", section: "Run my day", path: "calendar", keywords: ["schedule", "sessions", "booking"] },
  { key: "messages", label: "Messages", section: "Run my day", path: "messages", keywords: ["inbox", "chat", "dm"] },
  { key: "programs", label: "Programs", section: "Programming", path: "programs", keywords: ["workouts", "training", "builder"] },
  { key: "exercise-library", label: "Exercise Library", section: "Programming", path: "exercise-library", keywords: ["exercises", "movements"] },
  { key: "nutrition", label: "Meal Plans", section: "Nutrition", path: "nutrition", keywords: ["macros", "food", "diet"] },
  { key: "macro-calculator", label: "Macro Calculator", section: "Nutrition", path: "tools/macro-calculator", keywords: ["calories", "protein"] },
  { key: "recipes", label: "Recipe Hub", section: "Nutrition", path: "recipes", keywords: ["food", "meals"] },
  { key: "business", label: "Business overview", section: "Business", path: "business", keywords: ["money", "income", "revenue", "mrr"] },
  { key: "packages", label: "Packages", section: "Business", path: "business/packages", keywords: ["pricing", "plans", "subscriptions"] },
  { key: "availability", label: "Availability", section: "Business", path: "availability", keywords: ["hours", "open", "schedule"] },
  { key: "session-types", label: "Session types", section: "Business", path: "business/session-types", keywords: ["online", "in person"] },
  { key: "booking-page", label: "Booking page", section: "Business", path: "business/booking-page", keywords: ["public", "link", "book"] },
  { key: "group-sessions", label: "Group sessions", section: "Business", path: "group-sessions", keywords: ["classes"] },
  { key: "leads", label: "Leads", section: "Business", path: "business/leads", keywords: ["prospects", "inquiries"] },
  { key: "session-ledger", label: "Session ledger", section: "Business", path: "business/session-ledger", keywords: ["credits", "balance"] },
  { key: "waiver", label: "Waiver", section: "Business", path: "business/waiver", keywords: ["intake", "parq"] },
  { key: "sms-settings", label: "SMS notifications", section: "Business", path: "business/sms-settings", keywords: ["text"] },
  { key: "zapier", label: "Zapier", section: "Business", path: "business/zapier", keywords: ["automation", "integration"] },
  { key: "branding", label: "Organization", section: "Business", path: "branding", keywords: ["brand", "logo", "colors"] },
  { key: "support", label: "Support", section: "Business", path: "business/support", keywords: ["help"] },
  { key: "challenges", label: "Challenges", section: "Engage", path: "challenges", keywords: ["compete"] },
  { key: "records", label: "Hall of Fame", section: "Engage", path: "records", keywords: ["records", "prs"] },
  { key: "resources", label: "Resources", section: "Engage", path: "resources" },
  { key: "quick-tips", label: "Quick tips", section: "Engage", path: "quick-tips" },
  { key: "group-dashboard", label: "Group dashboard", section: "This group", path: "dashboard", groupOnly: true },
  { key: "team-performance", label: "Team performance", section: "This group", path: "team-performance", groupOnly: true, keywords: ["readiness", "trends"] },
  { key: "feed", label: "Team feed", section: "This group", path: "feed", groupOnly: true, keywords: ["posts", "community"] },
  { key: "depth-chart", label: "Depth chart", section: "This group", path: "team", groupOnly: true, keywords: ["positions", "roster"] },
  { key: "team-calendar", label: "Team calendar", section: "This group", path: "team/calendar", groupOnly: true, keywords: ["games", "practices"] },
];

// Only these can be shown in a pane: pages of the app itself. Anything else (another site, a protocol, a path trick) is refused, so a saved layout or a typed
// address can never make a pane load somewhere else.
export function isAllowedWorkspacePath(path: string): boolean {
  if (typeof path !== "string" || path.length === 0 || path.length > 500) return false;
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || path.includes(";")) return false;
  if (/[\u0000-\u001f]/.test(path)) return false;
  // An encoded dot, slash or backslash is read by the browser as the real thing ("%2e%2e" is ".."): none is allowed.
  if (/%(2e|2f|5c)/i.test(path)) return false;
  const first = path.split(/[?#]/)[0];
  if (first.includes("..")) return false;
  // Let the URL parser have the last word: what the browser would actually load must be the same address on the same site, with nothing collapsed or rewritten.
  let parsed: URL;
  try {
    parsed = new URL(path, "http://workspace.invalid");
  } catch {
    return false;
  }
  if (parsed.origin !== "http://workspace.invalid" || parsed.pathname !== first) return false;
  return first === "/dashboard" || first === "/clients" || /^\/groups\/[0-9a-fA-F-]{8,40}(\/|$)/.test(first);
}

// The pages offered for one group. `isShared` is true inside a team or social group (the group-only pages are then offered).
// A page of a group belongs to THAT group: its id carries the group id (so Programs of two groups are two different views and neither brings the other forward),
// and in a team or social group the group's name is in the section line.
export function pageDestinations(groupId: string, isShared: boolean, groupName?: string): WorkspaceDestination[] {
  return PAGES.filter((p) => !p.groupOnly || isShared).map((p) => ({
    id: p.absolute ? `page:${p.key}` : `page:${p.key}:${groupId}`,
    label: p.label,
    section: !p.absolute && isShared && groupName ? `${p.section} · ${groupName}` : p.section,
    path: p.absolute ? p.path : `/groups/${groupId}/${p.path}`,
    keywords: p.keywords,
  }));
}

export interface ClientRef {
  athleteId: string;
  name: string;
  groupId: string;
}

// One client's pages. A pane can show a client's profile (on any tab), their messages or their calendar.
export function clientDestinations(client: ClientRef): WorkspaceDestination[] {
  const base = `/groups/${client.groupId}`;
  const mk = (suffix: string, label: string, path: string, keywords: string[] = []): WorkspaceDestination => ({
    id: `client:${client.athleteId}:${suffix}`,
    label: `${client.name}: ${label}`,
    section: client.name,
    path,
    keywords: [client.name, ...keywords],
  });
  return [
    mk("profile", "profile", `${base}/athletes/${client.athleteId}`, ["overview"]),
    mk("messages", "messages", `${base}/messages/${client.athleteId}`, ["chat", "dm"]),
    mk("calendar", "calendar", `${base}/athletes/${client.athleteId}/calendar`, ["schedule", "habits", "macros"]),
    mk("programs", "programs", `${base}/athletes/${client.athleteId}?tab=program`, ["training", "workouts"]),
    mk("nutrition", "nutrition", `${base}/athletes/${client.athleteId}?tab=nutrition`, ["macros", "food"]),
    mk("progress", "progress", `${base}/athletes/${client.athleteId}?tab=progress`, ["charts", "photos", "wellness"]),
  ];
}

// ---- search ----
function tokens(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function scoreOne(d: WorkspaceDestination, qTokens: string[]): number {
  const label = d.label.toLowerCase();
  const section = d.section.toLowerCase();
  const kw = (d.keywords ?? []).map((k) => k.toLowerCase());
  let total = 0;
  for (const t of qTokens) {
    let best = 0;
    const words = label.split(/[^a-z0-9]+/).filter(Boolean);
    if (words.some((w) => w === t)) best = 100;
    else if (words.some((w) => w.startsWith(t))) best = 80;
    else if (label.includes(t)) best = 50;
    else if (kw.some((k) => k === t || k.startsWith(t))) best = 40;
    else if (section.includes(t)) best = 30;
    else if (kw.some((k) => k.includes(t))) best = 20;
    if (best === 0) return 0; // every word typed has to match something
    total += best;
  }
  return total;
}

// Best matches first; ties keep the order given. With nothing typed, returns the first `limit` as they are.
export function searchDestinations(all: WorkspaceDestination[], query: string, limit = 12): WorkspaceDestination[] {
  const q = tokens(query);
  if (q.length === 0) return all.slice(0, limit);
  return all
    .map((d, i) => ({ d, i, s: scoreOne(d, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.d);
}

// Recent destinations: newest first, no repeats, at most `max`.
export function pushRecent(recent: WorkspaceDestination[], dest: WorkspaceDestination, max = 8): WorkspaceDestination[] {
  return [dest, ...recent.filter((r) => r.id !== dest.id)].slice(0, max);
}
