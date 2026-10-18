// What changed in the app, for the people who use it (Release SP2). Newest first. Written for a coach or a client, not for a developer: what you can do now, in a sentence or two. Each release adds a line here when it ships;
// lib/changelog.test.ts keeps the list in order and free of internal wording.
export interface ChangelogEntry {
  date: string; // YYYY-MM-DD
  title: string;
  body: string;
  audience: "coaches" | "clients" | "everyone";
}

export const CHANGELOG: ChangelogEntry[] = [
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
