// Where things are in the app, and a free, instant way to find them. Ask Spot runs this BEFORE any AI: a plain request like
// "show me my calendar", "open Jordan's profile" or "add a client" resolves here with no model call, and answers as buttons
// (chips) that go straight to the place. Only real data questions ("how has Sam's squat been trending") go on to the AI.
//
// Every destination below must be a real page; lib/nav-intents.test.ts checks each path against the app's route table so a
// renamed or removed page fails the tests instead of quietly sending people nowhere.
import { findHowTos, type HowTo } from "@/lib/howto-library";

export type NavRole = "coach" | "athlete";
export type NavDevice = "desktop" | "phone";

export interface NavDestination {
  id: string;
  label: string;
  // Path with {groupId} and, for a client's pages, {athleteId}.
  path: string;
  // A different path on a phone (the coach phone Home is the group page, not /dashboard).
  phonePath?: string;
  roles: NavRole[];
  // Where it exists. Left out means both. Coach business pages are desktop-only.
  devices?: NavDevice[];
  synonyms: string[];
  needsAthlete?: boolean;
}

export interface NavChip {
  label: string;
  href: string;
}

// A client the coach can name. Each one lives in a group (a one-on-one client has their own), so their links use it.
export interface RosterClient {
  id: string;
  fullName: string;
  groupId?: string;
}

export interface HowToStepView {
  text: string;
  href?: string;
  linkLabel?: string;
}

export interface NavContext {
  role: NavRole;
  device: NavDevice;
  groupId: string | null;
  // The client whose page the person is on, so "this client" and "their profile" resolve.
  currentAthleteId?: string | null;
  // The coach's roster, for resolving names. Names only; the caller never sends anything else.
  roster?: RosterClient[];
}

export type NavResult =
  | { kind: "navigate"; text: string; chips: NavChip[]; intentIds: string[] }
  | { kind: "howto"; text: string; chips: NavChip[]; howto: HowTo; steps: HowToStepView[]; note?: string; intentIds: string[] }
  | { kind: "unsure"; text: string; chips: NavChip[]; intentIds: string[] }
  // A question about the person's own data. Carries the main places so there is still somewhere to go if the assistant is off.
  | { kind: "data"; chips: NavChip[] };

const D = (d: Omit<NavDestination, "needsAthlete"> & { needsAthlete?: boolean }): NavDestination => d;

export const NAV_DESTINATIONS: NavDestination[] = [
  // ---- Home ----
  D({ id: "home", label: "Home", path: "/dashboard", phonePath: "/groups/{groupId}", roles: ["coach"], synonyms: ["home", "dashboard", "home page", "main page", "start page", "overview", "my day", "today overview"] }),
  D({ id: "athlete-home", label: "Home", path: "/groups/{groupId}", roles: ["athlete"], synonyms: ["home", "home page", "main page", "start page", "overview", "dashboard"] }),
  // ---- People ----
  D({ id: "clients", label: "Clients", path: "/groups/{groupId}/clients", roles: ["coach"], synonyms: ["clients", "client list", "my clients", "roster", "all clients", "people", "athletes", "add a client", "add client", "new client", "invite a client", "add an athlete", "add athlete", "onboard a client"] }),
  D({ id: "messages", label: "Messages", path: "/groups/{groupId}/messages", roles: ["coach", "athlete"], synonyms: ["messages", "inbox", "chat", "dm", "dms", "direct messages", "message", "texts", "talk to my coach", "message my coach", "message coach"] }),
  D({ id: "announce", label: "Message all clients", path: "/groups/{groupId}/messages/announce", roles: ["coach"], devices: ["desktop", "phone"], synonyms: ["message all clients", "message everyone", "announcement", "announce", "bulk message", "send to everyone", "broadcast", "mass message", "message all", "text everyone", "broadcast to all clients", "message all my clients", "send to all clients"] }),
  D({ id: "team", label: "Team and depth chart", path: "/groups/{groupId}/team", roles: ["coach"], devices: ["desktop"], synonyms: ["team", "depth chart", "positions", "team roster", "team page"] }),
  D({ id: "team-calendar", label: "Team calendar", path: "/groups/{groupId}/team/calendar", roles: ["coach", "athlete"], devices: ["desktop"], synonyms: ["team calendar", "games", "practices", "practice schedule", "game schedule", "team schedule"] }),
  D({ id: "team-performance", label: "Team performance", path: "/groups/{groupId}/team-performance", roles: ["coach"], devices: ["desktop"], synonyms: ["team performance", "team stats", "team trends", "readiness trends"] }),
  // ---- Calendar and booking ----
  D({ id: "calendar", label: "Calendar", path: "/groups/{groupId}/calendar", roles: ["coach", "athlete"], synonyms: ["calendar", "my calendar", "schedule", "my schedule", "bookings", "sessions", "appointments", "book a session", "book session", "when am i booked", "what is on today", "upcoming sessions", "agenda"] }),
  D({ id: "availability", label: "Availability", path: "/groups/{groupId}/availability", roles: ["coach"], devices: ["desktop"], synonyms: ["availability", "my availability", "working hours", "open hours", "set hours", "business hours", "when i am free", "booking hours", "set my hours"] }),
  D({ id: "today", label: "Today's workout", path: "/groups/{groupId}/today", roles: ["athlete"], synonyms: ["today", "todays workout", "start workout", "my workout", "workout", "train", "start training", "what is my workout", "workout of the day", "log workout", "start my workout"] }),
  // ---- Programming ----
  D({ id: "programs", label: "Programs", path: "/groups/{groupId}/programs", roles: ["coach", "athlete"], synonyms: ["programs", "my programs", "program list", "training programs", "program builder", "builder", "programming", "all programs"] }),
  D({ id: "new-program", label: "Build a new program", path: "/groups/{groupId}/programs/new", roles: ["coach"], devices: ["desktop"], synonyms: ["new program", "build a program", "create a program", "make a program", "start a program", "write a program", "new training program", "build program"] }),
  D({ id: "import-program", label: "Import a program", path: "/groups/{groupId}/programs/import", roles: ["coach"], devices: ["desktop"], synonyms: ["import a program", "import program", "import", "upload a program", "photo of a program", "upload program", "bring in a program", "paste a program"] }),
  D({ id: "exercise-library", label: "Exercise library", path: "/groups/{groupId}/exercise-library", roles: ["coach"], devices: ["desktop"], synonyms: ["exercise library", "exercises", "library", "add an exercise", "exercise list", "movement library", "my exercises"] }),
  D({ id: "movement-patterns", label: "Movement patterns", path: "/groups/{groupId}/movement-patterns", roles: ["coach"], devices: ["desktop"], synonyms: ["movement patterns", "patterns", "ladders", "exercise ladders", "tiers"] }),
  D({ id: "nutrition", label: "Nutrition", path: "/groups/{groupId}/nutrition", roles: ["coach", "athlete"], synonyms: ["nutrition", "macros", "meal plan", "meal plans", "food", "diet", "calories", "what should i eat", "what do i eat", "my macros", "nutrition plan", "standing macro", "macro targets", "eating"] }),
  D({ id: "recipes", label: "Recipes", path: "/groups/{groupId}/recipes", roles: ["coach", "athlete"], synonyms: ["recipes", "recipe", "meal ideas", "cook"] }),
  D({ id: "macro-calculator", label: "Macro calculator", path: "/groups/{groupId}/tools/macro-calculator", roles: ["coach", "athlete"], synonyms: ["macro calculator", "calculate macros", "calorie calculator", "tdee", "macro tool"] }),
  D({ id: "one-rep-max", label: "1RM calculator", path: "/groups/{groupId}/tools/one-rep-max", roles: ["coach", "athlete"], synonyms: ["one rep max", "1rm", "1 rep max", "max calculator", "1rm calculator", "estimate my max", "rep max"] }),
  D({ id: "records", label: "Records", path: "/groups/{groupId}/records", roles: ["coach", "athlete"], synonyms: ["records", "prs", "personal records", "pr board", "my prs", "personal bests", "group records"] }),
  // ---- Community ----
  D({ id: "feed", label: "Team feed", path: "/groups/{groupId}/feed", roles: ["coach", "athlete"], synonyms: ["feed", "team feed", "posts", "community", "social", "activity", "announcements feed"] }),
  D({ id: "leaderboard", label: "Leaderboard", path: "/groups/{groupId}/leaderboard", roles: ["coach", "athlete"], synonyms: ["leaderboard", "rankings", "standings", "top lifters", "who is leading", "who is winning"] }),
  D({ id: "challenges", label: "Challenges", path: "/groups/{groupId}/challenges", roles: ["coach", "athlete"], synonyms: ["challenges", "challenge", "competition", "contests"] }),
  D({ id: "video-checkins", label: "Video check-ins", path: "/groups/{groupId}/video-checkins", roles: ["coach", "athlete"], synonyms: ["video check ins", "video checkins", "video check in", "form check", "form checks", "videos", "check in videos"] }),
  D({ id: "progress-photos", label: "Progress photos", path: "/groups/{groupId}/progress-photos", roles: ["athlete", "coach"], synonyms: ["progress photos", "photos", "before and after", "progress pictures", "transformation photos", "my photos"] }),
  D({ id: "my-history", label: "My workout history", path: "/groups/{groupId}/my-history", roles: ["athlete", "coach"], synonyms: ["my history", "workout history", "past workouts", "my logs", "history", "what i did", "previous workouts"] }),
  D({ id: "goal", label: "My goal", path: "/groups/{groupId}/goal", roles: ["athlete"], synonyms: ["my goal", "goal", "goals", "set a goal", "change my goal"] }),
  D({ id: "partners", label: "Training partners", path: "/partners", roles: ["athlete"], synonyms: ["training partner", "training partners", "find a partner", "workout partner", "gym buddy", "partners"] }),
  D({ id: "settings", label: "Settings", path: "/groups/{groupId}/settings", roles: ["coach", "athlete"], synonyms: ["settings", "my settings", "profile settings", "account", "my account", "preferences", "notifications", "turn on notifications", "push notifications", "sign out", "log out", "logout", "feedback", "report a problem", "send feedback", "change my name"] }),
  D({ id: "resources", label: "Resources", path: "/groups/{groupId}/resources", roles: ["coach", "athlete"], synonyms: ["resources", "pro shop", "shop", "supplements", "links", "recommended products"] }),
  D({ id: "quick-tips", label: "Quick tips", path: "/groups/{groupId}/quick-tips", roles: ["coach", "athlete"], synonyms: ["quick tips", "tips", "help tips"] }),
  // ---- Business (coach, desktop) ----
  D({ id: "business", label: "Business", path: "/groups/{groupId}/business", roles: ["coach"], devices: ["desktop"], synonyms: ["business", "revenue", "income", "money", "mrr", "business dashboard", "earnings", "how much am i making", "payments overview"] }),
  D({ id: "packages", label: "Packages", path: "/groups/{groupId}/business/packages", roles: ["coach"], devices: ["desktop"], synonyms: ["packages", "pricing", "create a package", "add a package", "session packs", "memberships", "subscriptions", "prices", "set my prices"] }),
  D({ id: "session-ledger", label: "Session ledger", path: "/groups/{groupId}/business/session-ledger", roles: ["coach"], devices: ["desktop"], synonyms: ["session ledger", "ledger", "who owes sessions", "session balances", "credit balances", "balances", "sessions owed", "owed sessions"] }),
  D({ id: "booking-page", label: "Booking page", path: "/groups/{groupId}/business/booking-page", roles: ["coach"], devices: ["desktop"], synonyms: ["booking page", "public booking page", "booking link", "online booking", "my booking link", "book with me link", "share my booking page", "let people book", "booking site", "scheduling page", "calendly"] }),
  D({ id: "session-types", label: "Session types", path: "/groups/{groupId}/business/session-types", roles: ["coach"], devices: ["desktop"], synonyms: ["session types", "session type", "types of sessions"] }),
  D({ id: "leads", label: "Leads", path: "/groups/{groupId}/business/leads", roles: ["coach"], devices: ["desktop"], synonyms: ["leads", "prospects", "inquiries", "new leads", "gym visitors"] }),
  D({ id: "sms-settings", label: "Text message settings", path: "/groups/{groupId}/business/sms-settings", roles: ["coach"], devices: ["desktop"], synonyms: ["sms", "text messages", "text settings", "texting", "sms settings", "text notifications"] }),
  D({ id: "waiver", label: "Waiver", path: "/groups/{groupId}/business/waiver", roles: ["coach"], devices: ["desktop"], synonyms: ["waiver", "liability waiver", "intake form", "par q", "waiver text"] }),
  D({ id: "zapier", label: "Zapier and webhooks", path: "/groups/{groupId}/business/zapier", roles: ["coach"], devices: ["desktop"], synonyms: ["zapier", "webhooks", "integrations", "automation", "connect zapier"] }),
  D({ id: "support", label: "Contact support", path: "/groups/{groupId}/business/support", roles: ["coach"], devices: ["desktop"], synonyms: ["support", "contact support", "help", "get help", "talk to support", "i need help", "support request"] }),
  D({ id: "revenue-splits", label: "Revenue splits", path: "/groups/{groupId}/revenue-splits", roles: ["coach"], devices: ["desktop"], synonyms: ["revenue splits", "split revenue", "pay split", "coach splits", "revenue share"] }),
  D({ id: "branding", label: "Organization and branding", path: "/groups/{groupId}/branding", roles: ["coach"], devices: ["desktop"], synonyms: ["branding", "organization", "my organization", "org settings", "logo", "colors", "brand colors", "invite a coach", "add a trainer", "add a coach", "plan and billing", "my plan", "credits", "ai credits", "find a coach listing", "marketplace listing"] }),
  D({ id: "kiosk", label: "Kiosk check-in", path: "/groups/{groupId}/kiosk", roles: ["coach"], devices: ["desktop"], synonyms: ["kiosk", "check in screen", "kiosk mode", "front desk check in", "attendance kiosk"] }),
  D({ id: "kiosk-settings", label: "Kiosk PINs", path: "/groups/{groupId}/kiosk/settings", roles: ["coach"], devices: ["desktop"], synonyms: ["kiosk pins", "kiosk settings", "set pins", "check in pins"] }),
  D({ id: "display", label: "TV display mode", path: "/groups/{groupId}/display", roles: ["coach"], devices: ["desktop"], synonyms: ["display mode", "tv mode", "weight room display", "gym screen", "tv display"] }),
  D({ id: "referrals", label: "Referrals", path: "/groups/{groupId}/referrals", roles: ["coach"], devices: ["desktop"], synonyms: ["referrals", "referral links", "referral partners"] }),
  D({ id: "find-a-coach", label: "Find a coach", path: "/find-a-coach", roles: ["coach", "athlete"], synonyms: ["find a coach", "coach directory", "marketplace", "find me a coach"] }),
  // ---- A client's own pages (coach) ----
  D({ id: "client-profile", label: "Client profile", path: "/groups/{groupId}/athletes/{athleteId}", roles: ["coach"], needsAthlete: true, synonyms: ["profile", "client profile", "their profile", "open profile", "go to profile", "view profile", "page", "overview", "balance", "sessions left", "sign in link", "sign-in link", "claim link"] }),
  D({ id: "client-calendar", label: "Client calendar", path: "/groups/{groupId}/athletes/{athleteId}/calendar", roles: ["coach"], needsAthlete: true, devices: ["desktop"], synonyms: ["calendar", "schedule", "their calendar", "habits", "macros calendar", "schedule weekly", "weekly", "book weekly", "recurring", "repeat sessions", "plan their week"] }),
  D({ id: "client-history", label: "Client history", path: "/groups/{groupId}/athletes/{athleteId}/history", roles: ["coach"], needsAthlete: true, synonyms: ["history", "workout history", "logs", "past workouts", "their workouts", "what they did"] }),
  D({ id: "client-log", label: "Log an in-person session", path: "/groups/{groupId}/athletes/{athleteId}/log", roles: ["coach"], needsAthlete: true, synonyms: ["log session", "log a session", "log workout", "log in person", "in person session", "log for them", "start their workout", "log a workout for"] }),
];

// ---------------------------------------------------------------------------------------------------------------------
// Matching

const FILLER = new Set([
  "please", "pls", "can", "could", "would", "you", "me", "my", "the", "a", "an", "to", "go", "open", "show", "take", "i", "want",
  "need", "view", "see", "find", "where", "is", "are", "of", "for", "on", "in", "at", "its", "it", "get", "bring", "up", "now",
  "let", "lets", "us", "just", "page", "screen", "section", "tab", "link", "with", "and", "do", "does", "this", "that", "s", "im",
]);

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]s(?=\s|$)/g, "")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function contentTokens(norm: string): string[] {
  return norm.split(" ").filter((t) => t && !FILLER.has(t));
}

function hasPhrase(haystack: string, phrase: string): boolean {
  if (!phrase) return false;
  return ` ${haystack} `.includes(` ${phrase} `);
}

const DATA_PATTERNS: RegExp[] = [
  /\bhow (many|much|often|long|has|have|is|are|did|does|was|were|well)\b/,
  /\bwhen did\b/,
  /\bwho (has|hasnt|haven|have|is|are|did|didnt|logged|missed|trained)\b/,
  /\b(trend|trending|progressing|progressed|improv|plateau|stuck|regress|average|total|compare|versus|vs)\b/,
  /\blast (session|workout|time|logged)\b/,
  /\b(readiness|soreness|sleep quality|energy level|consistency|adherence|compliance)\b/,
  /\bthis week\b.*\b(log|train|miss|skip)/,
  /\b(why|what happened)\b/,
];

const HOWTO_PATTERNS: RegExp[] = [/\bhow (do|can|would|should|to) (i|we|you)?/, /\bhow to\b/, /\bhelp me\b/, /\bsteps\b/, /\bwalk me through\b/, /\bwhere do i\b/, /\bhow does\b/, /\bwhat is the way\b/, /\bteach me\b/, /\btutorial\b/, /\bguide\b/];

function applicable(d: NavDestination, ctx: NavContext): boolean {
  return d.roles.includes(ctx.role);
}

function resolvePath(d: NavDestination, ctx: NavContext, athleteId: string | null, groupId: string | null = ctx.groupId): string | null {
  const template = ctx.device === "phone" && d.phonePath ? d.phonePath : d.path;
  if (template.includes("{athleteId}")) {
    if (!athleteId) return null;
  }
  if (template.includes("{groupId}") && !groupId) return null;
  return template.replace("{groupId}", groupId ?? "").replace("{athleteId}", athleteId ?? "");
}

// Which clients a message names. A first name that belongs to one client, or a full or last name, counts.
export function findClientMentions(norm: string, roster: RosterClient[]): RosterClient[] {
  const tokens = new Set(norm.split(" "));
  const byFirst = new Map<string, RosterClient[]>();
  for (const c of roster) {
    const first = normalize(c.fullName).split(" ")[0];
    if (!first) continue;
    byFirst.set(first, [...(byFirst.get(first) ?? []), c]);
  }
  const hits = new Map<string, RosterClient>();
  for (const c of roster) {
    const parts = normalize(c.fullName).split(" ").filter(Boolean);
    if (parts.length === 0) continue;
    const full = parts.join(" ");
    if (parts.length > 1 && hasPhrase(norm, full)) {
      hits.set(c.id, c);
      continue;
    }
    const first = parts[0];
    const last = parts.length > 1 ? parts[parts.length - 1] : null;
    if (first.length >= 3 && tokens.has(first) && (byFirst.get(first)?.length ?? 0) === 1) {
      hits.set(c.id, c);
    } else if (last && last.length >= 4 && tokens.has(last)) {
      hits.set(c.id, c);
    }
  }
  // A first name shared by several clients matches all of them, so the person can pick.
  for (const [first, list] of byFirst) {
    if (list.length > 1 && first.length >= 3 && tokens.has(first)) for (const c of list) hits.set(c.id, c);
  }
  return [...hits.values()];
}

function scoreDestination(d: NavDestination, norm: string, tokens: string[]): number {
  let best = 0;
  for (const syn of d.synonyms) {
    const s = normalize(syn);
    if (!s) continue;
    if (hasPhrase(norm, s)) {
      // A longer matching phrase is a more specific request.
      best = Math.max(best, 20 + s.split(" ").length * 3);
      continue;
    }
    const sTokens = contentTokens(s);
    if (sTokens.length === 0) continue;
    const overlap = sTokens.filter((t) => tokens.includes(t)).length;
    if (overlap === sTokens.length && sTokens.length > 1) best = Math.max(best, 14 + sTokens.length);
    else if (overlap > 0) best = Math.max(best, (overlap / sTokens.length) * 8);
  }
  // The destination's own label is a synonym too.
  const label = normalize(d.label);
  if (hasPhrase(norm, label)) best = Math.max(best, 20 + label.split(" ").length * 3);
  return best;
}

const CONFIDENT = 20;
// A data-sounding question still goes to the places list when it names a place with a phrase this strong (3+ words).
const DATA_PLACE_OVERRIDE = 28;
const CLOSE = 4;

function chipFor(d: NavDestination, ctx: NavContext, athleteId: string | null, labelOverride?: string): NavChip | null {
  const clientGroup = athleteId ? ctx.roster?.find((r) => r.id === athleteId)?.groupId ?? ctx.groupId : ctx.groupId;
  const href = resolvePath(d, ctx, athleteId, clientGroup);
  if (!href) return null;
  return { label: labelOverride ?? d.label, href };
}

function fallbackChips(ctx: NavContext): NavChip[] {
  const ids = ctx.role === "coach" ? ["home", "clients", "calendar"] : ["athlete-home", "today", "calendar"];
  return ids
    .map((id) => NAV_DESTINATIONS.find((d) => d.id === id))
    .filter((d): d is NavDestination => !!d)
    .map((d) => chipFor(d, ctx, null))
    .filter((c): c is NavChip => !!c);
}

// The one entry point. Returns what to show, or { kind: "data" } when the message is a question about the person's data and
// should go on to the AI. Never returns an empty answer: when it is not sure it offers the closest places.
export function resolveNavigation(message: string, ctx: NavContext): NavResult {
  const norm = normalize(message);
  if (!norm) return { kind: "unsure", text: "Tell me where you want to go, or what you want to do.", chips: fallbackChips(ctx), intentIds: [] };
  const tokens = contentTokens(norm);

  const wantsHowTo = HOWTO_PATTERNS.some((p) => p.test(norm));
  const looksLikeData = DATA_PATTERNS.some((p) => p.test(norm)) && !wantsHowTo;

  const roster = ctx.roster ?? [];
  const mentions = ctx.role === "coach" ? findClientMentions(norm, roster) : [];
  const thisClient = /\b(this client|this athlete|him|her|them|their|his)\b/.test(norm) ? ctx.currentAthleteId ?? null : null;

  // A data question goes to the AI, unless the words also clearly name a place ("how much am I making" is the Business page).
  if (looksLikeData) {
    const bestPlace = NAV_DESTINATIONS.filter((d) => applicable(d, ctx) && !d.needsAthlete).reduce((m, d) => Math.max(m, scoreDestination(d, norm, tokens)), 0);
    if (bestPlace < DATA_PLACE_OVERRIDE) return { kind: "data", chips: fallbackChips(ctx) };
  }

  // How-to questions: curated steps, with the destination as a chip as well.
  const howtos = findHowTos(norm, ctx.role, ctx.device);
  // Without "how do I" wording, a how-to only wins over a place when it matches more strongly ("booking page" is the page).
  const bestPlaceScore = NAV_DESTINATIONS.filter((d) => applicable(d, ctx) && !d.needsAthlete).reduce((m, d) => Math.max(m, scoreDestination(d, norm, tokens)), 0);
  if (howtos.length > 0 && (wantsHowTo || (howtos[0].score >= 24 && howtos[0].score > bestPlaceScore))) {
    const top = howtos[0];
    if (ctx.device === "phone" && top.howto.desktopOnly) {
      return {
        kind: "unsure",
        text: `${top.howto.title} is done in the desktop version of the app. Open it on a computer. Here is what is on your phone:`,
        chips: fallbackChips(ctx),
        intentIds: [`howto:${top.howto.id}`],
      };
    }
    const chips: NavChip[] = [];
    for (const step of top.howto.steps) {
      if (!step.href) continue;
      const href = step.href.replace("{groupId}", ctx.groupId ?? "");
      if (step.href.includes("{groupId}") && !ctx.groupId) continue;
      if (!chips.some((c) => c.href === href)) chips.push({ label: step.linkLabel ?? top.howto.title, href });
      if (chips.length >= 2) break;
    }
    return {
      kind: "howto",
      text: top.howto.title,
      howto: top.howto,
      steps: top.howto.steps.map((s) => ({
        text: s.text,
        href: s.href && ctx.groupId ? s.href.replace("{groupId}", ctx.groupId) : undefined,
        linkLabel: s.linkLabel,
      })),
      note: top.howto.note,
      chips,
      intentIds: [`howto:${top.howto.id}`],
    };
  }

  // A named client: their profile, calendar, history or the in-person log, by the other words in the message.
  const clientId = mentions.length === 1 ? mentions[0].id : thisClient;
  if (mentions.length > 1) {
    const profile = NAV_DESTINATIONS.find((d) => d.id === "client-profile")!;
    const chips = mentions
      .slice(0, 4)
      .map((m) => chipFor(profile, ctx, m.id, `${m.fullName}'s profile`))
      .filter((c): c is NavChip => !!c);
    if (chips.length > 0) {
      return { kind: "navigate", text: "More than one client matches. Which one?", chips, intentIds: ["client-profile"] };
    }
  }
  if (clientId) {
    const clientDests = NAV_DESTINATIONS.filter((d) => d.needsAthlete && applicable(d, ctx));
    const scored = clientDests
      .map((d) => ({ d, score: scoreDestination(d, norm, tokens) }))
      .filter((x) => !(ctx.device === "phone" && x.d.devices && !x.d.devices.includes("phone")))
      .sort((a, b) => b.score - a.score);
    const pick = scored[0] && scored[0].score >= CLOSE ? scored[0].d : clientDests.find((d) => d.id === "client-profile")!;
    const name = roster.find((r) => r.id === clientId)?.fullName ?? "this client";
    const chip = chipFor(pick, ctx, clientId, `${name}: ${pick.label.toLowerCase()}`);
    if (chip) return { kind: "navigate", text: "Here you go.", chips: [chip], intentIds: [pick.id] };
  }

  // A plain destination.
  const candidates = NAV_DESTINATIONS.filter((d) => applicable(d, ctx) && !d.needsAthlete)
    .map((d) => ({ d, score: scoreDestination(d, norm, tokens) }))
    .sort((a, b) => b.score - a.score);
  const best = candidates[0];

  if (best && best.score >= CONFIDENT) {
    // Desktop-only place asked for from a phone: say so, and never leave it at that.
    if (ctx.device === "phone" && best.d.devices && !best.d.devices.includes("phone")) {
      const near = candidates
        .filter((c) => c.score >= CLOSE && !(c.d.devices && !c.d.devices.includes("phone")))
        .slice(0, 3)
        .map((c) => chipFor(c.d, ctx, null))
        .filter((c): c is NavChip => !!c);
      return {
        kind: "unsure",
        text: `${best.d.label} is in the desktop version of the app. Open it on a computer. Here is what is on your phone:`,
        chips: near.length > 0 ? near : fallbackChips(ctx),
        intentIds: [best.d.id],
      };
    }
    const chip = chipFor(best.d, ctx, null);
    // Ties (two destinations with the same top score) are offered together.
    const ties = candidates
      .filter((c) => c.score === best.score && c.d.id !== best.d.id && !(ctx.device === "phone" && c.d.devices && !c.d.devices.includes("phone")))
      .slice(0, 2)
      .map((c) => chipFor(c.d, ctx, null))
      .filter((c): c is NavChip => !!c);
    if (chip) return { kind: "navigate", text: "Here you go.", chips: [chip, ...ties], intentIds: [best.d.id] };
  }

  // Not sure: the closest places, then the common ones. Never a dead end.
  const near = candidates
    .filter((c) => c.score >= CLOSE && !(ctx.device === "phone" && c.d.devices && !c.d.devices.includes("phone")))
    .slice(0, 3)
    .map((c) => chipFor(c.d, ctx, null))
    .filter((c): c is NavChip => !!c);
  const chips = near.length > 0 ? near : fallbackChips(ctx);
  if (!wantsHowTo && looksLikeData === false && near.length === 0 && tokens.length >= 4) {
    // A longer message with nothing that looks like navigation: let the AI try, if it is available.
    return { kind: "data", chips: fallbackChips(ctx) };
  }
  return {
    kind: "unsure",
    text: near.length > 0 ? "I am not sure which one you mean. Closest places:" : "I could not find that. These are the main places:",
    chips,
    intentIds: near.map((_, i) => candidates[i]?.d.id).filter(Boolean) as string[],
  };
}
