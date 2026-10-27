// What changed in the app, for the people who use it (Release SP2). Newest first. Written for a coach or a client, not for a developer: what you can do now, in a sentence or two. Each release adds a line here when it ships;
// lib/changelog.test.ts keeps the list in order and free of internal wording.
export interface ChangelogEntry {
  date: string; // YYYY-MM-DD
  title: string;
  body?: string; // a line or two more, when the title alone does not say it
  audience: "coaches" | "clients" | "everyone";
}

export const CHANGELOG: ChangelogEntry[] = [
  { date: "2026-10-26", title: "Make a template from any program, with Programs and Templates tabs", audience: "coaches" },
  { date: "2026-10-26", title: "Organization programs: assign to clients and to whole groups", audience: "coaches" },
  { date: "2026-10-26", title: "Import matches you can trust: exact names win, and old matches are labelled", audience: "coaches" },
  { date: "2026-10-26", title: "The AI builder can change later weeks of a program", audience: "coaches" },
  { date: "2026-10-26", title: "Spotlight demo videos on exercises in the Spotlight library, until you add your own", audience: "everyone" },
  { date: "2026-10-24", title: "Get [name] started checklist on a new client's profile", audience: "coaches" },
  { date: "2026-10-21", title: "Your phone starts in your own organization", audience: "coaches" },
  { date: "2026-10-21", title: "Coach nutrition revamp", audience: "coaches" },
  { date: "2026-10-21", title: "Allergy question asked once", audience: "clients" },
  { date: "2026-10-20", title: "Wing it logging", audience: "coaches" },
  { date: "2026-10-20", title: "Logging during a booked time uses that session", audience: "coaches" },
  { date: "2026-10-20", title: "Walk-in prompt", audience: "coaches" },
  { date: "2026-10-20", title: "No-show Charge or Waive", audience: "coaches" },
  { date: "2026-10-20", title: "Faster phone app", audience: "everyone" },
  { date: "2026-10-20", title: "The Spotlight button on the phone", audience: "coaches" },
  { date: "2026-10-20", title: "One calendar that people book on", audience: "everyone" },
  { date: "2026-10-19", title: "Did-it-happen cards", audience: "coaches" },
  { date: "2026-10-19", title: "A public page with a free consultation, made for you", audience: "coaches" },
  {
    date: "2026-10-18",
    title: "Remove a client without losing them",
    body: "Remove from my clients takes a client off your lists and keeps their account and history; Put back under Removed clients on Members returns them as they were. Delete permanently now gives you 30 days to change your mind.",
    audience: "coaches",
  },
  {
    date: "2026-10-18",
    title: "Payment problems, in one place",
    body: "A failed payment, a refund or a dispute from a client now sends you a notice and shows under Payment problems on Business, for the last 90 days. Nothing else changes by itself.",
    audience: "coaches",
  },
  {
    date: "2026-10-18",
    title: "Pause automatic nutrition suggestions for one client",
    body: "On a client's Nutrition tab, No automatic suggestions stops the weekly check-in from suggesting changes for them, in every group, until you switch it back on.",
    audience: "coaches",
  },
  {
    date: "2026-10-18",
    title: "A notice when support replies",
    body: "When we answer a support request, you now get a notice, so you do not have to keep checking the thread.",
    audience: "coaches",
  },
  {
    date: "2026-10-18",
    title: "This week, for every client at a glance",
    body: "Coaches have a new This week tab on Nutrition: each client's last seven days of logging against their target, with the people who need you first.",
    audience: "coaches",
  },
  {
    date: "2026-10-17",
    title: "Your own grocery list",
    body: "On the Nutrition tab, clients now see a grocery list built from the next seven days of their meal plan, ready to copy or print. Foods that break their food preferences are left off.",
    audience: "clients",
  },
  {
    date: "2026-10-17",
    title: "AI meal options stay close to the target",
    body: "Meal suggestions from the Nutrition Spot are now checked against the meal's protein, carbs, fat and calories. An option that lands far off is left out instead of offered.",
    audience: "coaches",
  },
  {
    date: "2026-10-17",
    title: "The AI will not change a program clients are training on",
    body: "The AI day builder now refuses to edit a program that clients have started. It tells you to make a copy first, so no one's plan changes under them.",
    audience: "coaches",
  },
  {
    date: "2026-10-17",
    title: "Team coaches get team-first menus",
    body: "A coach who runs a team sees the team's tiles on Home and menus trimmed to what a team coach uses, while a coach with one-on-one clients keeps every menu.",
    audience: "coaches",
  },
  {
    date: "2026-10-17",
    title: "Cleaner Settings",
    body: "The Garmin connect button now only appears for people who have already connected, so Settings shows what you can use.",
    audience: "clients",
  },
];
